// Collecting money against credit invoices, and using a customer's advance credit.
// Call inside db.$transaction. The CUSTOMER ROW is locked first, so everything touching one customer's
// money (sales, collections, credit use) queues up and the numbers can never be double-counted.
//
// Lock order (matches post-sale.ts): customer row → invoice rows → payment counter.
import { Prisma, type PaymentMethod, type PaymentStatus } from "@/generated/prisma/client";
import { CashError, defaultLocationId, recordPaymentCash } from "@/lib/cash/ledger";
import { nextDocumentNo, type Dec, type Tx } from "@/lib/inventory/engine";
import { parseMoney } from "@/lib/money";
import { netPaid, netTotal, owedOf } from "./owed";

const D = Prisma.Decimal;

/** A problem the person recording the payment can fix. fieldErrors keys: "amount", "method", "alloc.<saleId>". */
export class CollectionError extends Error {
  constructor(
    message: string,
    public fieldErrors: Record<string, string> = {},
  ) {
    super(message);
  }
}

/** Pass the NET figures: (total - returned) and (paid - refunded). */
export const statusFor = (netTotalAmount: Dec, netPaidAmount: Dec): PaymentStatus => (netPaidAmount.gte(netTotalAmount) ? "PAID" : netPaidAmount.isZero() ? "UNPAID" : "PARTIALLY_PAID");

/** Advance credit: money received from the customer that is not (yet) allocated to any invoice. */
export async function customerCredit(tx: Pick<Tx, "$queryRaw">, customerId: string): Promise<Dec> {
  const rows = await tx.$queryRaw<{ s: Prisma.Decimal | string | null }[]>`
    SELECT COALESCE(SUM(p."amount" - COALESCE(a."s", 0)), 0) AS s
      FROM "Payment" p
      LEFT JOIN (SELECT "paymentId", SUM("amount") AS s FROM "PaymentAllocation" GROUP BY "paymentId") a ON a."paymentId" = p."id"
     WHERE p."customerId" = ${customerId}`;
  return new D((rows[0]?.s ?? 0).toString());
}

async function lockCustomer(tx: Tx, customerId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${customerId} FOR UPDATE`;
  const c = await tx.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true } });
  if (!c) throw new CollectionError("This customer no longer exists.");
  return c;
}

type RawAllocation = { saleId: string; amount: string };

/** Validates the chosen invoices (right customer, still owing, amounts within what is owed) and locks them. */
async function loadAllocations(tx: Tx, customerId: string, raw: RawAllocation[], dp: number) {
  if (raw.length === 0) return [];
  if (raw.length > 100) throw new CollectionError("Too many invoices selected at once (max 100).");
  const errors: Record<string, string> = {};
  const seen = new Set<string>();
  const parsed: { saleId: string; amount: Dec }[] = [];
  for (const a of raw) {
    if (seen.has(a.saleId)) {
      errors[`alloc.${a.saleId}`] = "This invoice was selected twice.";
      continue;
    }
    seen.add(a.saleId);
    const amt = parseMoney(a.amount, dp);
    if (!amt || amt.lte(0)) errors[`alloc.${a.saleId}`] = dp === 0 ? "Enter a whole amount." : "Enter a valid amount.";
    else parsed.push({ saleId: a.saleId, amount: amt });
  }
  if (Object.keys(errors).length) throw new CollectionError("Please fix the highlighted invoices.", errors);

  const ids = parsed.map((p) => p.saleId).sort();
  await tx.$queryRaw`SELECT "id" FROM "Sale" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`;
  const sales = await tx.sale.findMany({ where: { id: { in: ids } }, select: { id: true, saleNo: true, locationId: true, customerId: true, status: true, total: true, amountPaid: true, returnedTotal: true, refundedTotal: true } });
  const byId = new Map(sales.map((s) => [s.id, s]));

  return parsed.map((p) => {
    const s = byId.get(p.saleId);
    if (!s || s.customerId !== customerId) throw new CollectionError("An invoice does not belong to this customer.", { [`alloc.${p.saleId}`]: "Not this customer's invoice." });
    if (s.status !== "COMPLETED") throw new CollectionError(`${s.saleNo} is not an active invoice.`, { [`alloc.${p.saleId}`]: "Not an active invoice." });
    const owed = owedOf(s);
    if (owed.lte(0)) throw new CollectionError(`${s.saleNo} is already fully paid.`, { [`alloc.${p.saleId}`]: "Already fully paid." });
    if (p.amount.gt(owed)) throw new CollectionError(`${s.saleNo}: the payment is more than the balance of ${owed.toString()}.`, { [`alloc.${p.saleId}`]: `More than the balance (${owed.toString()}).` });
    return { sale: s, amount: p.amount };
  });
}

async function bumpSales(tx: Tx, rows: { sale: { id: string; total: Dec; amountPaid: Dec; returnedTotal: Dec; refundedTotal: Dec }; amount: Dec }[]) {
  for (const { sale, amount } of rows) {
    const paid = sale.amountPaid.plus(amount);
    const next = { ...sale, amountPaid: paid };
    await tx.sale.update({ where: { id: sale.id }, data: { amountPaid: paid, paymentStatus: statusFor(netTotal(next), netPaid(next)) } });
  }
}

// ───────────── Collecting a payment ─────────────

export type CollectionInput = {
  user: { id: string };
  customerId: string;
  method: PaymentMethod;
  /** the exact account the money went into (CRDB, M-PESA, ...); required when the method has several open accounts */
  accountId?: string | null;
  amount: string;
  reference: string | null;
  notes: string | null;
  allocations: RawAllocation[];
  /** the person explicitly agreed that any amount above the selected invoices is kept as customer credit */
  keepExtraAsCredit: boolean;
  submissionKey: string;
  currencyDecimals: number;
};

export async function postCollection(tx: Tx, input: CollectionInput) {
  const dp = input.currencyDecimals;
  const amount = parseMoney(input.amount, dp);
  if (!amount || amount.lte(0)) throw new CollectionError("Enter the amount received.", { amount: dp === 0 ? "Enter a whole amount above zero." : "Enter an amount above zero." });

  const customer = await lockCustomer(tx, input.customerId);
  const rows = await loadAllocations(tx, customer.id, input.allocations, dp);

  const allocated = rows.reduce((s, r) => s.plus(r.amount), new D(0));
  if (allocated.gt(amount)) throw new CollectionError("The invoices selected add up to more than the amount received.", { amount: `Invoices add up to ${allocated.toString()}.` });
  const extra = amount.minus(allocated);
  if (extra.gt(0) && !input.keepExtraAsCredit) {
    throw new CollectionError(
      allocated.isZero()
        ? "Choose which invoices this payment is for, or record it as customer credit."
        : `The payment is ${extra.toString()} more than the invoices selected. Select more invoices, or keep the extra as customer credit.`,
      { amount: "More than the selected invoices." },
    );
  }

  const paymentNo = await nextDocumentNo(tx, "PAY");
  const payment = await tx.payment.create({
    data: {
      paymentNo,
      source: "DEBT_COLLECTION",
      customerId: customer.id,
      method: input.method,
      amount,
      reference: input.reference,
      notes: input.notes,
      receivedById: input.user.id,
      submissionKey: input.submissionKey,
      allocations: { create: rows.map((r) => ({ saleId: r.sale.id, amount: r.amount })) },
    },
  });
  await bumpSales(tx, rows);
  try {
    // The money is paid to the SHOP. An invoice that was sold from a Winga's custody location (a "sold report") is still paid to the
    // shop's till or accounts, never into accounts at the Winga's own location (the shop's closing would never count them).
    const saleLocationId = rows[0]?.sale.locationId;
    const saleLocation = saleLocationId ? await tx.location.findUnique({ where: { id: saleLocationId }, select: { type: true } }) : null;
    let cashLocationId = saleLocationId;
    if (saleLocation?.type === "RESELLER") {
      const chosen = input.accountId ? await tx.cashAccount.findUnique({ where: { id: input.accountId }, select: { locationId: true, location: { select: { type: true } } } }) : null;
      if (chosen && chosen.location.type === "RESELLER") throw new CashError("This account does not exist here.", { accountId: "Choose an account from the list." });
      cashLocationId = chosen ? chosen.locationId : await defaultLocationId(tx);
    }
    await recordPaymentCash(tx, { id: payment.id, paymentNo, source: "DEBT_COLLECTION", method: input.method, amount, accountId: input.accountId }, { locationId: cashLocationId, userId: input.user.id });
  } catch (e) {
    if (e instanceof CashError) throw new CollectionError(e.message, { accountId: e.fieldErrors?.accountId ?? e.message });
    throw e;
  }

  return { payment, allocated, extra, invoices: rows.map((r) => ({ saleNo: r.sale.saleNo, amount: r.amount })) };
}

// ───────────── Using advance credit ─────────────

export type ApplyCreditInput = {
  user: { id: string };
  customerId: string;
  allocations: RawAllocation[];
  notes: string | null;
  submissionKey: string;
  currencyDecimals: number;
};

export async function postCreditApplication(tx: Tx, input: ApplyCreditInput) {
  const customer = await lockCustomer(tx, input.customerId);
  const rows = await loadAllocations(tx, customer.id, input.allocations, input.currencyDecimals);
  if (rows.length === 0) throw new CollectionError("Choose the invoices to pay with the customer's credit.");

  const total = rows.reduce((s, r) => s.plus(r.amount), new D(0));
  const available = await customerCredit(tx, customer.id);
  if (total.gt(available)) throw new CollectionError(`The customer only has ${available.toString()} of credit.`, { credit: `Available credit is ${available.toString()}.` });

  const application = await tx.creditApplication.create({
    data: { customerId: customer.id, amount: total, notes: input.notes, submissionKey: input.submissionKey, createdById: input.user.id },
  });

  // Draw from the oldest payments that still have unallocated money.
  const sources = (
    await tx.$queryRaw<{ id: string; remaining: Prisma.Decimal | string }[]>`
      SELECT p."id", p."amount" - COALESCE(SUM(a."amount"), 0) AS remaining
        FROM "Payment" p LEFT JOIN "PaymentAllocation" a ON a."paymentId" = p."id"
       WHERE p."customerId" = ${customer.id}
       GROUP BY p."id" HAVING p."amount" - COALESCE(SUM(a."amount"), 0) > 0
       ORDER BY p."receivedAt", p."id"`
  ).map((s) => ({ id: s.id, remaining: new D(s.remaining.toString()) }));

  let cursor = 0;
  for (const row of rows) {
    let need = row.amount;
    while (need.gt(0)) {
      const src = sources[cursor];
      if (!src) throw new CollectionError("The customer's credit could not be matched to payments. Please try again.");
      const take = Prisma.Decimal.min(need, src.remaining);
      await tx.paymentAllocation.create({ data: { paymentId: src.id, saleId: row.sale.id, amount: take, creditApplicationId: application.id } });
      src.remaining = src.remaining.minus(take);
      need = need.minus(take);
      if (src.remaining.isZero()) cursor++;
    }
  }
  await bumpSales(tx, rows);

  return { application, total, invoices: rows.map((r) => ({ saleNo: r.sale.saleNo, amount: r.amount })) };
}
