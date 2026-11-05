// Returns and cancellations. The original sale is NEVER edited: a reversal adds credit-note totals to it
// (returnedTotal / refundedTotal), puts stock back through the stock engine, and records why.
//
//   request  → a PENDING SaleReversal (nothing else changes)
//   approve  → everything below happens in ONE transaction
//   reject   → the request is closed, nothing changes
//
// Lock order (consistent with sales and collections): customer row → sale row → product rows → stock balances.
import { Prisma, type PaymentMethod, type ReturnCondition, type ReversalKind } from "@/generated/prisma/client";
import { applyIncomingCost, lockProducts, moveStock, nextDocumentNo, type Dec, type Tx } from "@/lib/inventory/engine";
import { toBaseQuantity, validateQuantity } from "@/lib/units";
import { netPaid, netTotal } from "./owed";
import { statusFor } from "./collections";

const D = Prisma.Decimal;

/** A problem the person can fix. fieldErrors keys: "reason", "refundMethod", "line.<saleItemId>". */
export class ReversalError extends Error {
  constructor(
    message: string,
    public fieldErrors: Record<string, string> = {},
  ) {
    super(message);
  }
}

export type ReversalLineInput = { saleItemId: string; quantity: string; condition: ReturnCondition };

export type RequestInput = {
  user: { id: string };
  saleId: string;
  kind: ReversalKind;
  reason: string;
  refundMethod: PaymentMethod | null;
  refundReference: string | null;
  lines: ReversalLineInput[];
  submissionKey: string;
};

/** How many of each sale line have already been returned (completed reversals; optionally pending ones too). */
export async function returnedBySaleItem(tx: Pick<Tx, "reversalItem">, saleId: string, includePending: boolean) {
  const rows = await tx.reversalItem.findMany({
    where: { reversal: { saleId, status: { in: includePending ? ["COMPLETED", "PENDING"] : ["COMPLETED"] } } },
    select: { saleItemId: true, enteredQty: true, returnValue: true },
  });
  const qty = new Map<string, Dec>();
  const value = new Map<string, Dec>();
  for (const r of rows) {
    qty.set(r.saleItemId, (qty.get(r.saleItemId) ?? new D(0)).plus(r.enteredQty));
    value.set(r.saleItemId, (value.get(r.saleItemId) ?? new D(0)).plus(r.returnValue));
  }
  return { qty, value };
}

// ───────────── 1. Request ─────────────

export async function createReversalRequest(tx: Tx, input: RequestInput) {
  const reason = input.reason.trim();
  if (reason.length < 5) throw new ReversalError("Say why (at least 5 characters).", { reason: "Give a reason (at least 5 characters)." });

  const sale = await tx.sale.findUnique({ where: { id: input.saleId }, include: { items: { include: { enteredUnit: true } } } });
  if (!sale) throw new ReversalError("This sale no longer exists.");
  if (sale.status !== "COMPLETED") throw new ReversalError("This sale has already been cancelled.");

  const done = await returnedBySaleItem(tx, sale.id, true); // completed + waiting requests
  const lines: { saleItemId: string; productId: string; enteredQty: Dec; factor: Dec; quantity: Dec; condition: ReturnCondition }[] = [];
  const errors: Record<string, string> = {};

  if (input.kind === "CANCEL") {
    // Cancelling undoes whatever is left of the sale; the goods go back on the shelf.
    for (const it of sale.items) {
      const left = it.enteredQty.minus(done.qty.get(it.id) ?? 0);
      if (left.gt(0)) lines.push({ saleItemId: it.id, productId: it.productId, enteredQty: left, factor: it.factor, quantity: left.mul(it.factor), condition: "RESELLABLE" });
    }
    if (lines.length === 0) throw new ReversalError("Everything on this sale has already been returned.");
  } else {
    const seen = new Set<string>();
    for (const l of input.lines) {
      const it = sale.items.find((x) => x.id === l.saleItemId);
      if (!it) {
        errors[`line.${l.saleItemId}`] = "This item is not on the sale.";
        continue;
      }
      if (seen.has(it.id)) {
        errors[`line.${it.id}`] = "This item was listed twice.";
        continue;
      }
      seen.add(it.id);
      const q = validateQuantity(l.quantity, it.enteredUnit.allowsDecimal);
      if (!q.ok) {
        errors[`line.${it.id}`] = q.error;
        continue;
      }
      const left = it.enteredQty.minus(done.qty.get(it.id) ?? 0);
      if (q.value.gt(left)) {
        errors[`line.${it.id}`] = left.isZero() ? "Already fully returned." : `Only ${left.toString()} can still be returned.`;
        continue;
      }
      const base = toBaseQuantity(q.value, it.factor);
      if (!base.ok) {
        errors[`line.${it.id}`] = base.error;
        continue;
      }
      lines.push({ saleItemId: it.id, productId: it.productId, enteredQty: q.value, factor: it.factor, quantity: base.value, condition: l.condition });
    }
    if (Object.keys(errors).length) throw new ReversalError("Please fix the highlighted items.", errors);
    if (lines.length === 0) throw new ReversalError("Choose at least one item to return.", { lines: "Choose at least one item to return." });
  }

  const reversalNo = await nextDocumentNo(tx, "REV");
  return tx.saleReversal.create({
    data: {
      reversalNo,
      saleId: sale.id,
      kind: input.kind,
      reason,
      refundMethod: input.refundMethod,
      refundReference: input.refundReference,
      requestedById: input.user.id,
      submissionKey: input.submissionKey, // a duplicate submission fails here
      items: { create: lines },
    },
    include: { items: true },
  });
}

// ───────────── 2. Approve (complete) ─────────────

export async function completeReversal(tx: Tx, input: { reversalId: string; approver: { id: string }; note?: string | null; dp: number }) {
  const peek = await tx.saleReversal.findUnique({ where: { id: input.reversalId }, select: { sale: { select: { id: true, customerId: true } } } });
  if (!peek) throw new ReversalError("This request no longer exists.");

  // Locks in the shared order
  if (peek.sale.customerId) await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${peek.sale.customerId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "Sale" WHERE "id" = ${peek.sale.id} FOR UPDATE`;

  const reversal = await tx.saleReversal.findUniqueOrThrow({ where: { id: input.reversalId }, include: { items: true } });
  if (reversal.status !== "PENDING") throw new ReversalError(`This request was already ${reversal.status.toLowerCase()}.`);
  const sale = await tx.sale.findUniqueOrThrow({ where: { id: reversal.saleId }, include: { items: true } });
  if (sale.status !== "COMPLETED") throw new ReversalError("This sale has already been cancelled.");

  await lockProducts(tx, reversal.items.map((i) => i.productId));
  const done = await returnedBySaleItem(tx, sale.id, false); // only what has really been returned already
  const itemById = new Map(sale.items.map((i) => [i.id, i]));

  // Work out each line's value at the price actually charged (the last unit absorbs any rounding).
  let returnValue = new D(0);
  const priced: { id: string; value: Dec; cost: Dec; line: (typeof reversal.items)[number]; saleItem: (typeof sale.items)[number] }[] = [];
  for (const line of reversal.items) {
    const si = itemById.get(line.saleItemId)!;
    const alreadyQty = done.qty.get(si.id) ?? new D(0);
    const left = si.enteredQty.minus(alreadyQty);
    if (line.enteredQty.gt(left)) throw new ReversalError(`${left.isZero() ? "Already fully returned" : `Only ${left.toString()} can still be returned`} for one of the items. The request is out of date.`);
    const value = line.enteredQty.eq(left) ? si.lineTotal.minus(done.value.get(si.id) ?? 0) : si.lineTotal.mul(line.enteredQty).div(si.enteredQty).toDecimalPlaces(input.dp);
    const cost = line.condition === "RESELLABLE" ? si.unitCost.mul(line.quantity).toDecimalPlaces(2) : new D(0);
    priced.push({ id: line.id, value, cost, line, saleItem: si });
    returnValue = returnValue.plus(value);
  }

  // Money: goods come back, so the invoice shrinks. If that leaves the customer having paid more than is now due, the excess is refunded.
  const newReturned = sale.returnedTotal.plus(returnValue);
  if (newReturned.gt(sale.total)) throw new ReversalError("The return is worth more than the sale. The request is out of date.");
  const netTotalAfter = sale.total.minus(newReturned);
  const refund = Prisma.Decimal.max(netPaid(sale).minus(netTotalAfter), 0);
  if (refund.gt(0) && !reversal.refundMethod) {
    throw new ReversalError(`The customer is owed a refund of ${refund.toString()} but no refund method was chosen. Reject this request and ask for it again with the refund method.`, { refundMethod: "Choose how the refund is paid." });
  }

  // Stock back through the stock engine
  const ordered = [...priced].sort((a, b) => a.line.productId.localeCompare(b.line.productId));
  const ref = { referenceType: "SaleReversal", referenceId: reversal.id, referenceNo: reversal.reversalNo, userId: input.approver.id };
  for (const p of ordered) {
    const unitCost = p.saleItem.unitCost;
    if (p.line.condition === "RESELLABLE") {
      await applyIncomingCost(tx, p.line.productId, p.line.quantity, unitCost); // before the quantity moves in
      await moveStock(tx, { ...ref, productId: p.line.productId, locationId: sale.locationId, type: "CUSTOMER_RETURN", delta: p.line.quantity, unitCost, reason: reversal.reason });
    } else {
      // Damaged goods come back and are written off straight away: the ledger shows both steps, and sellable stock does not change.
      await moveStock(tx, { ...ref, productId: p.line.productId, locationId: sale.locationId, type: "CUSTOMER_RETURN", delta: p.line.quantity, unitCost, reason: `${reversal.reason} (damaged)` });
      await moveStock(tx, { ...ref, productId: p.line.productId, locationId: sale.locationId, type: "DAMAGED", delta: p.line.quantity.neg(), unitCost, reason: `Returned damaged: ${reversal.reason}` });
    }
  }

  // The sale's credit-note totals and status (its original figures stay untouched)
  const after = { total: sale.total, amountPaid: sale.amountPaid, returnedTotal: newReturned, refundedTotal: sale.refundedTotal.plus(refund) };
  await tx.sale.update({
    where: { id: sale.id },
    data: {
      returnedTotal: after.returnedTotal,
      refundedTotal: after.refundedTotal,
      status: newReturned.eq(sale.total) ? "CANCELLED" : "COMPLETED",
      paymentStatus: statusFor(netTotal(after), netPaid(after)),
    },
  });

  // Fill in the values while the request is still PENDING, then close it.
  for (const p of priced) await tx.reversalItem.update({ where: { id: p.id }, data: { returnValue: p.value, costValue: p.cost } });
  const done2 = await tx.saleReversal.update({
    where: { id: reversal.id },
    data: { status: "COMPLETED", decidedById: input.approver.id, decidedAt: new Date(), decisionNote: input.note ?? null, returnValue, refundAmount: refund },
  });
  return { reversal: done2, returnValue, refund, saleNo: sale.saleNo, saleCancelled: newReturned.eq(sale.total), requestedById: reversal.requestedById };
}

// ───────────── 3. Reject ─────────────

export async function rejectReversal(tx: Tx, input: { reversalId: string; approver: { id: string }; note: string }) {
  const note = input.note.trim();
  if (note.length < 3) throw new ReversalError("Give a short reason for rejecting.", { note: "Say why it is rejected." });
  await tx.$queryRaw`SELECT "id" FROM "SaleReversal" WHERE "id" = ${input.reversalId} FOR UPDATE`;
  const r = await tx.saleReversal.findUnique({ where: { id: input.reversalId }, include: { sale: { select: { saleNo: true } } } });
  if (!r) throw new ReversalError("This request no longer exists.");
  if (r.status !== "PENDING") throw new ReversalError(`This request was already ${r.status.toLowerCase()}.`);
  const updated = await tx.saleReversal.update({ where: { id: r.id }, data: { status: "REJECTED", decidedById: input.approver.id, decidedAt: new Date(), decisionNote: note } });
  return { reversal: updated, saleNo: r.sale.saleNo, requestedById: r.requestedById };
}
