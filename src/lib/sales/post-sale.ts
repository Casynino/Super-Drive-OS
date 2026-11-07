// Posting a sale. Call inside db.$transaction. Everything below commits together or not at all:
// invoice + lines, stock deduction (ledger), payment + allocation, and the credit-limit check.
//
// Lock order (always the same, so concurrent sales can't deadlock):
//   invoice number counter → customer row → product rows (shared) → stock balance rows → payment counter.
import { randomUUID } from "node:crypto";
import { Prisma, type PaymentMethod } from "@/generated/prisma/client";
import { CashError, recordPaymentCash } from "@/lib/cash/ledger";
import { lockProductsShared, nextDocumentNo, type Dec, type Tx } from "@/lib/inventory/engine";
import { ItemError, moveStockTracked, resolveItemCodes } from "@/lib/inventory/items";
import { resolveLines } from "@/lib/inventory/lines";
import { parseMoney } from "@/lib/money";
import { createPickupNote } from "@/lib/warehouse/pickup";
import { WINGA_MAX_DAYS } from "@/lib/resellers/rules";
import { customerOutstanding, customerOverdue } from "./outstanding";
import { isWholesaleType, listPrice } from "./pricing";

const D = Prisma.Decimal;

/** A problem the cashier can fix. fieldErrors keys: "line.<i>", "customer", "payment", "partAmount", "method". */
export class SaleError extends Error {
  constructor(
    message: string,
    public fieldErrors: Record<string, string> = {},
  ) {
    super(message);
  }
}

/** The sale would take the customer over their credit limit and no authorised exception was given. */
export class CreditLimitError extends SaleError {
  constructor(
    message: string,
    public details: { outstanding: Dec; thisSale: Dec; limit: Dec },
  ) {
    super(message, { customer: message });
  }
}

export type SaleMode = "FULL" | "CREDIT" | "PART";

export type SaleInput = {
  user: { id: string };
  can: { discount: boolean; credit: boolean; approveCreditException: boolean };
  customerId: string | null;
  locationId: string;
  mode: SaleMode;
  method: PaymentMethod | null;
  /** the exact account the money went into (CRDB, M-PESA, ...); required when the method has several open accounts */
  accountId?: string | null;
  partAmount: string | null;
  reference: string | null;
  notes: string | null;
  /** why a discount was given; required whenever the sale has one */
  discountReason?: string | null;
  /**
   * unitPrice "" means "charge the list price". itemCodes are the pieces scanned for this line (QR text, token or item number);
   * only for lines sold in the base unit. Those exact pieces are marked sold; the rest of the quantity is taken by quantity.
   */
  lines: { productId: string; unitId: string; quantity: string; unitPrice: string; itemCodes?: string[] }[];
  creditException: { reason: string } | null;
  /** the day the customer says they will pay what is left on credit (YYYY-MM-DD). A Winga uses their own pay period instead. */
  dueDate?: string | null;
  /** the till sets this: a normal customer needs a phone, ID number and place on record before taking goods on credit */
  creditDetailsRequired?: boolean;
  /**
   * A reseller's sold report: an invoice on the reseller's account for goods taken from their custody location, at the
   * prices agreed when the stock was issued (per BASE unit). Credit limits do not apply: the exposure is the stock already issued.
   */
  reseller?: { id: string; basePrices: Map<string, Dec> };
  submissionKey: string;
  currencyDecimals: number;
  creditTermsDays: number;
};

const money = (d: Dec, decimals: number) => d.toDecimalPlaces(decimals);

function addDays(ymd: string, days: number) {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}
const businessToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(new Date());

export async function postSale(tx: Tx, input: SaleInput) {
  const dp = input.currencyDecimals;

  // 1. Payment mode sanity (cheap checks first, nothing locked yet)
  if (input.reseller && (input.mode !== "CREDIT" || !input.customerId)) throw new SaleError("A winga's sold report is invoiced on the winga's account.");
  if (input.mode !== "FULL" && !input.can.credit && !input.reseller) throw new SaleError("You are not allowed to record credit or part-payment sales.", { payment: "Not allowed for your role." });
  if (input.mode !== "CREDIT" && !input.method) throw new SaleError("Choose how the customer paid.", { method: "Choose cash, mobile money or bank." });
  if (input.mode !== "FULL" && !input.customerId) throw new SaleError("Choose the customer. Credit and part-payment sales must be linked to a customer.", { customer: "Choose a customer for credit sales." });
  if (input.lines.length === 0) throw new SaleError("Add at least one product.", { lines: "Add at least one product." });

  // 2. Locks, in the documented order
  const saleNo = await nextDocumentNo(tx, "INV");

  let customer: { id: string; name: string; type: string; status: string; creditLimit: Dec; phone: string | null; winga: boolean; wingaDays: number; idNumber: string | null; place: string | null } | null = null;
  if (input.customerId) {
    await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${input.customerId} FOR UPDATE`;
    const row = await tx.customer.findUnique({ where: { id: input.customerId }, select: { id: true, name: true, type: true, status: true, creditLimit: true, phone: true, idNumber: true, businessLocation: true, reseller: { select: { id: true, settlementDays: true } } } });
    customer = row ? { id: row.id, name: row.name, type: row.type, status: row.status, creditLimit: row.creditLimit, phone: row.phone, winga: Boolean(row.reseller), wingaDays: row.reseller?.settlementDays ?? 14, idNumber: row.idNumber, place: row.businessLocation } : null;
    if (!customer) throw new SaleError("This customer no longer exists.", { customer: "Customer not found." });
    if (customer.status !== "ACTIVE") throw new SaleError(`${customer.name} is deactivated and cannot buy.`, { customer: "Customer is deactivated." });
  }

  await lockProductsShared(tx, input.lines.map((l) => l.productId));

  // 3. Trusted lines + prices (all from the database; the browser only says what and how many)
  const resolved = await resolveLines(tx, input.lines.map((l) => ({ productId: l.productId, unitId: l.unitId, quantity: l.quantity })), { perProductUnit: true });
  if (!resolved.ok) {
    const fe = Object.fromEntries(Object.entries(resolved.errors).map(([i, m]) => [`line.${i}`, m]));
    throw new SaleError(resolved.message, fe);
  }

  // A product that is sold in cartons only can never leave as single pieces (checked here, not just hidden in the screen)
  if (!input.reseller) {
    const rules = await tx.product.findMany({ where: { id: { in: resolved.lines.map((l) => l.productId) } }, select: { id: true, name: true, baseUnitId: true, allowPieceSales: true, _count: { select: { units: true } } } });
    for (const l of resolved.lines) {
      const r = rules.find((x) => x.id === l.productId);
      if (r && !r.allowPieceSales && r._count.units > 0 && l.enteredUnitId === r.baseUnitId) throw new SaleError(`${r.name} is sold by the carton only.`, { [`line.${l.index}`]: "Sold by the carton only." });
    }
  }

  const wholesale = isWholesaleType(customer?.type);
  const errors: Record<string, string> = {};
  const priced = resolved.lines.flatMap((l) => {
    let list: Dec;
    if (input.reseller) {
      const agreed = input.reseller.basePrices.get(l.productId);
      if (!agreed) {
        errors[`line.${l.index}`] = `${l.productName} was never issued to this winga.`;
        return [];
      }
      list = money(agreed.mul(l.factor), dp);
    } else {
      list = listPrice(l, wholesale);
    }
    if (list.lte(0)) {
      errors[`line.${l.index}`] = `No selling price is set for ${l.productName}.`;
      return [];
    }
    const raw = input.lines[l.index]!.unitPrice.trim();
    let price = list;
    if (raw !== "") {
      const p = parseMoney(raw, dp);
      if (!p) {
        errors[`line.${l.index}`] = dp === 0 ? "Enter the price as a whole amount." : "Enter a valid price.";
        return [];
      }
      price = p;
    }
    if (price.gt(list)) {
      errors[`line.${l.index}`] = "The price cannot be higher than the list price.";
      return [];
    }
    if (price.lt(list) && !input.can.discount) {
      errors[`line.${l.index}`] = "You are not allowed to give discounts.";
      return [];
    }
    const lineList = money(l.enteredQty.mul(list), dp);
    const lineTotal = money(l.enteredQty.mul(price), dp);
    return [{ l, list, price, lineList, lineTotal, discount: lineList.minus(lineTotal), costTotal: l.quantity.mul(l.avgCost).toDecimalPlaces(2) }];
  });
  if (Object.keys(errors).length) throw new SaleError("Please fix the highlighted items.", errors);

  const subtotal = priced.reduce((s, p) => s.plus(p.lineList), new D(0));
  const discountTotal = priced.reduce((s, p) => s.plus(p.discount), new D(0));
  const total = subtotal.minus(discountTotal);
  const cogsTotal = priced.reduce((s, p) => s.plus(p.costTotal), new D(0));
  if (total.lte(0)) throw new SaleError("The sale total must be greater than zero.", { lines: "The sale total must be greater than zero." });
  const discountReason = input.discountReason?.trim() || null;
  if (discountTotal.gt(0) && (!discountReason || discountReason.length < 3)) {
    throw new SaleError("Give a reason for the discount.", { discountReason: "Say why the discount was given." });
  }

  // 4. How much is paid now, and how much goes on credit
  let paidNow: Dec;
  if (input.mode === "FULL") paidNow = total;
  else if (input.mode === "CREDIT") paidNow = new D(0);
  else {
    const p = parseMoney(input.partAmount, dp);
    if (!p || p.lte(0) || p.gte(total)) throw new SaleError("The part payment must be more than zero and less than the total.", { partAmount: "Enter an amount between 0 and the total." });
    paidNow = p;
  }
  const onCredit = total.minus(paidNow);

  // Anything left on credit needs a customer we can reach: the phone number is how late payments are followed up.
  if (onCredit.gt(0) && !customer?.phone?.trim()) {
    throw new SaleError(`${customer?.name ?? "This customer"} has no phone number. Add one on the customer's page first: it is used to remind them when payment is late.`, { customer: "This customer needs a phone number for credit." });
  }

  // A normal customer who takes goods on credit must be known: phone, ID number and place on record, and the day they will pay.
  // (A Winga is registered with all of that, and pays within their own pay period.)
  if (onCredit.gt(0) && !input.reseller && customer && !customer.winga) {
    if (input.creditDetailsRequired) {
      const missing = [!customer.idNumber?.trim() && "an ID number", !customer.place?.trim() && "a place (where they live or work)"].filter(Boolean) as string[];
      if (missing.length) throw new SaleError(`${customer.name} needs ${missing.join(" and ")} on their record before taking goods on credit. Add it on the customer's page.`, { customer: "This customer's details are not complete for credit." });
    }
    if (input.dueDate !== undefined && input.dueDate !== null) {
      const today = businessToday();
      const latest = addDays(today, 365).toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) || input.dueDate < today || input.dueDate > latest) throw new SaleError("Choose the day the customer will pay: from today up to one year ahead.", { dueDate: "Choose a pay-by date from today up to one year ahead." });
    }
  }

  // A Winga who has not paid what was due gets no more goods on credit until he pays.
  if (onCredit.gt(0) && !input.reseller && customer?.winga) {
    const late = await customerOverdue(tx, customer.id, businessToday());
    if (late.amount.gt(0)) {
      const since = late.since ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(late.since) : "";
      throw new SaleError(`${customer.name} has not paid what was due${since ? ` (since ${since})` : ""}: ${late.amount.toString()}. He must pay before he can take more goods.`, { customer: "This Winga must pay what is overdue first." });
    }
  }

  // 5. Credit limit (customer row is locked, so two cashiers can't both slip under the limit)
  let creditApprovedById: string | null = null;
  let creditExceptionReason: string | null = null;
  // A Winga always takes goods on credit (Nino 2026-11-08): for them a credit limit of 0 means "no cap", a limit above 0 is still a cap.
  const wingaNoCap = customer?.winga === true && customer.creditLimit.lte(0);
  if (onCredit.gt(0) && !input.reseller && !wingaNoCap) {
    const outstanding = await customerOutstanding(tx, customer!.id);
    const limit = customer!.creditLimit;
    if (outstanding.plus(onCredit).gt(limit)) {
      const why = limit.lte(0)
        ? `${customer!.name} has no credit limit set.`
        : `This would take ${customer!.name} over their credit limit (owes ${outstanding.toString()}, this sale adds ${onCredit.toString()}, limit ${limit.toString()}).`;
      if (input.creditException && input.can.approveCreditException) {
        creditApprovedById = input.user.id;
        creditExceptionReason = input.creditException.reason;
      } else {
        throw new CreditLimitError(`${why} A manager must approve an exception.`, { outstanding, thisSale: onCredit, limit });
      }
    }
  }

  // 6. The invoice and its lines
  const sorted = [...priced].sort((a, b) => a.l.productId.localeCompare(b.l.productId) || a.l.enteredUnitId.localeCompare(b.l.enteredUnitId));
  const lineIds = new Map(sorted.map(({ l }) => [l.index, randomUUID()])); // known up front so scanned pieces can point at their invoice line
  const dueDate = onCredit.gt(0)
    ? customer?.winga && !input.reseller
      ? addDays(businessToday(), Math.min(customer.wingaDays, WINGA_MAX_DAYS)) // a Winga pays within 3 days at the most
      : input.dueDate && !input.reseller
        ? addDays(input.dueDate, 0)
        : addDays(businessToday(), input.creditTermsDays)
    : null;
  const sale = await tx.sale.create({
    data: {
      saleNo,
      customerId: customer?.id ?? null,
      locationId: input.locationId,
      salespersonId: input.user.id,
      subtotal,
      discountTotal,
      total,
      amountPaid: paidNow,
      paymentStatus: paidNow.eq(total) ? "PAID" : paidNow.isZero() ? "UNPAID" : "PARTIALLY_PAID",
      dueDate,
      cogsTotal,
      notes: input.notes,
      discountReason: discountTotal.gt(0) ? discountReason : null,
      creditApprovedById,
      creditExceptionReason,
      channel: input.reseller ? "RESELLER" : "SHOP",
      resellerId: input.reseller?.id ?? null,
      submissionKey: input.submissionKey, // a duplicate submission fails here, before stock is touched
      items: {
        create: sorted.map(({ l, list, price, discount, lineTotal, costTotal }) => ({
          id: lineIds.get(l.index)!,
          productId: l.productId,
          enteredQty: l.enteredQty,
          enteredUnitId: l.enteredUnitId,
          factor: l.factor,
          quantity: l.quantity,
          listPrice: list,
          unitPrice: price,
          discount,
          lineTotal,
          unitCost: l.avgCost,
          costTotal,
        })),
      },
    },
  });

  // From a pickup location (the Store Warehouse) the goods are only RESERVED now and leave when the attendant hands them over
  // (see releasePickup). Everywhere else the stock leaves at once, as before.
  const location = await tx.location.findUnique({ where: { id: input.locationId }, select: { pickupRequired: true } });
  const usePickup = Boolean(location?.pickupRequired) && !input.reseller;
  if (usePickup && input.lines.some((l) => (l.itemCodes?.length ?? 0) > 0)) throw new SaleError("Pieces are not scanned when selling from the warehouse: the attendant checks the goods when they are collected.");

  // 7. Stock out, one ledger row per line (refused if there isn't enough; the whole sale then rolls back)
  for (const { l } of usePickup ? [] : sorted) {
    const codes = input.lines[l.index]!.itemCodes ?? [];
    try {
      // scanned pieces are marked sold exactly; the rest of the quantity is taken from stock without items, then the oldest pieces
      if (codes.length > 0 && !l.factor.eq(1)) throw new ItemError("Items can only be scanned for single pieces, not cartons.", "WRONG_PRODUCT");
      const itemIds = await resolveItemCodes(tx, codes);
      await moveStockTracked(
        tx,
        {
          productId: l.productId,
          locationId: input.locationId,
          type: "SOLD",
          delta: l.quantity.neg(),
          unitCost: l.avgCost,
          referenceType: "Sale",
          referenceId: sale.id,
          referenceNo: saleNo,
          userId: input.user.id,
        },
        { itemIds, saleId: sale.id, saleItemId: lineIds.get(l.index) },
      );
    } catch (e) {
      // a scanned piece that cannot be sold becomes a message on that line ("This product has already been sold.")
      if (e instanceof ItemError) throw new SaleError(e.message, { [`line.${l.index}`]: e.message });
      throw e;
    }
  }

  // 8. Money received now: a payment, allocated to this invoice (later payments follow the same path)
  let payment: { id: string; paymentNo: string } | null = null;
  if (paidNow.gt(0)) {
    const paymentNo = await nextDocumentNo(tx, "PAY");
    const p = await tx.payment.create({
      data: {
        paymentNo,
        source: "AT_SALE",
        customerId: customer?.id ?? null,
        method: input.method!,
        amount: paidNow,
        reference: input.reference,
        receivedById: input.user.id,
        allocations: { create: { saleId: sale.id, amount: paidNow } },
      },
    });
    payment = { id: p.id, paymentNo };
    // The money is now in the till / mobile money / bank, in the same transaction as the sale.
    try {
      await recordPaymentCash(tx, { id: p.id, paymentNo, source: "AT_SALE", method: input.method!, amount: paidNow, accountId: input.accountId }, { locationId: input.locationId, userId: input.user.id });
    } catch (e) {
      if (e instanceof CashError) throw new SaleError(e.message, { accountId: e.fieldErrors?.accountId ?? e.message });
      throw e;
    }
  }

  // 9. The pickup note with its QR code: reserves the goods (refused if the available stock does not cover them)
  const pickup = usePickup
    ? await createPickupNote(tx, {
        saleId: sale.id,
        saleNo,
        locationId: input.locationId,
        userId: input.user.id,
        auth: onCredit.isZero() ? "PAID" : paidNow.gt(0) ? "PART_PAID" : "CREDIT_APPROVED",
        lines: sorted.map(({ l }) => ({ saleItemId: lineIds.get(l.index)!, productId: l.productId, quantity: l.quantity })),
      })
    : null;

  return { sale, payment, creditExceptionUsed: creditApprovedById !== null, onCredit, total, pickup };
}
