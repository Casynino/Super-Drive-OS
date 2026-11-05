// Posting a sale. Call inside db.$transaction. Everything below commits together or not at all:
// invoice + lines, stock deduction (ledger), payment + allocation, and the credit-limit check.
//
// Lock order (always the same, so concurrent sales can't deadlock):
//   invoice number counter → customer row → product rows (shared) → stock balance rows → payment counter.
import { Prisma, type PaymentMethod } from "@/generated/prisma/client";
import { recordPaymentCash } from "@/lib/cash/ledger";
import { lockProductsShared, moveStock, nextDocumentNo, type Dec, type Tx } from "@/lib/inventory/engine";
import { resolveLines } from "@/lib/inventory/lines";
import { parseMoney } from "@/lib/money";
import { customerOutstanding } from "./outstanding";
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
  partAmount: string | null;
  reference: string | null;
  notes: string | null;
  /** why a discount was given; required whenever the sale has one */
  discountReason?: string | null;
  /** unitPrice "" means "charge the list price" */
  lines: { productId: string; unitId: string; quantity: string; unitPrice: string }[];
  creditException: { reason: string } | null;
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
  if (input.reseller && (input.mode !== "CREDIT" || !input.customerId)) throw new SaleError("A reseller's sold report is invoiced on the reseller's account.");
  if (input.mode !== "FULL" && !input.can.credit && !input.reseller) throw new SaleError("You are not allowed to record credit or part-payment sales.", { payment: "Not allowed for your role." });
  if (input.mode !== "CREDIT" && !input.method) throw new SaleError("Choose how the customer paid.", { method: "Choose cash, mobile money or bank." });
  if (input.mode !== "FULL" && !input.customerId) throw new SaleError("Choose the customer. Credit and part-payment sales must be linked to a customer.", { customer: "Choose a customer for credit sales." });
  if (input.lines.length === 0) throw new SaleError("Add at least one product.", { lines: "Add at least one product." });

  // 2. Locks, in the documented order
  const saleNo = await nextDocumentNo(tx, "INV");

  let customer: { id: string; name: string; type: string; status: string; creditLimit: Dec } | null = null;
  if (input.customerId) {
    await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${input.customerId} FOR UPDATE`;
    customer = await tx.customer.findUnique({ where: { id: input.customerId }, select: { id: true, name: true, type: true, status: true, creditLimit: true } });
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

  const wholesale = isWholesaleType(customer?.type);
  const errors: Record<string, string> = {};
  const priced = resolved.lines.flatMap((l) => {
    let list: Dec;
    if (input.reseller) {
      const agreed = input.reseller.basePrices.get(l.productId);
      if (!agreed) {
        errors[`line.${l.index}`] = `${l.productName} was never issued to this reseller.`;
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

  // 5. Credit limit (customer row is locked, so two cashiers can't both slip under the limit)
  let creditApprovedById: string | null = null;
  let creditExceptionReason: string | null = null;
  if (onCredit.gt(0) && !input.reseller) {
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
  const dueDate = onCredit.gt(0) ? addDays(businessToday(), input.creditTermsDays) : null;
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

  // 7. Stock out, one ledger row per line (refused if there isn't enough; the whole sale then rolls back)
  for (const { l } of sorted) {
    await moveStock(tx, {
      productId: l.productId,
      locationId: input.locationId,
      type: "SOLD",
      delta: l.quantity.neg(),
      unitCost: l.avgCost,
      referenceType: "Sale",
      referenceId: sale.id,
      referenceNo: saleNo,
      userId: input.user.id,
    });
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
    await recordPaymentCash(tx, { id: p.id, paymentNo, source: "AT_SALE", method: input.method!, amount: paidNow }, { locationId: input.locationId, userId: input.user.id });
  }

  return { sale, payment, creditExceptionUsed: creditApprovedById !== null, onCredit, total };
}
