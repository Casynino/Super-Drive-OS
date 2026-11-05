import { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

export type StatementLine = {
  at: Date;
  kind: "INVOICE" | "PAYMENT" | "RETURN" | "REFUND";
  ref: string;
  refId: string;
  description: string;
  debit: Dec; // increases what the customer owes
  credit: Dec; // reduces it
  balance: Dec; // running balance after this line
};

type RawLine = Omit<StatementLine, "balance"> & { order: number };
export type Statement = { opening: Dec; lines: StatementLine[]; closing: Dec };

/**
 * Chronological account statement. Balance = invoices − returns (credit notes) − payments received + refunds paid out. A negative balance means the
 * customer has paid in advance. Cash sales to a registered customer appear as an invoice and its payment,
 * which cancel out, so the statement always agrees with what is really owed.
 */
export async function getStatement(db: Pick<Db, "sale" | "payment" | "saleReversal">, customerId: string, from?: Date, to?: Date): Promise<Statement> {
  const range: Prisma.DateTimeFilter | undefined = from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : undefined;

  const revRange = range ? { decidedAt: range } : {};
  const [invoices, payments, beforeInv, beforePay, reversals, beforeRev] = await Promise.all([
    db.sale.findMany({
      // cancelled sales stay on the statement: their invoice, return and refund cancel each other out
      where: { customerId, ...(range ? { createdAt: range } : {}) },
      select: { id: true, saleNo: true, createdAt: true, total: true, dueDate: true },
    }),
    db.payment.findMany({
      where: { customerId, ...(range ? { receivedAt: range } : {}) },
      select: { id: true, paymentNo: true, receivedAt: true, amount: true, method: true, source: true, reference: true },
    }),
    from ? db.sale.aggregate({ where: { customerId, createdAt: { lt: from } }, _sum: { total: true } }) : null,
    from ? db.payment.aggregate({ where: { customerId, receivedAt: { lt: from } }, _sum: { amount: true } }) : null,
    db.saleReversal.findMany({
      where: { status: "COMPLETED", sale: { customerId }, ...revRange },
      select: { id: true, reversalNo: true, kind: true, decidedAt: true, returnValue: true, refundAmount: true, refundMethod: true, sale: { select: { saleNo: true } } },
    }),
    from ? db.saleReversal.aggregate({ where: { status: "COMPLETED", sale: { customerId }, decidedAt: { lt: from } }, _sum: { returnValue: true, refundAmount: true } }) : null,
  ]);

  const opening = (beforeInv?._sum.total ?? new D(0))
    .minus(beforePay?._sum.amount ?? new D(0))
    .minus(beforeRev?._sum.returnValue ?? new D(0))
    .plus(beforeRev?._sum.refundAmount ?? new D(0));
  const METHOD: Record<string, string> = { CASH: "Cash", MOBILE_MONEY: "Mobile money", BANK: "Bank" };

  const raw = [
    ...invoices.map((i) => ({ at: i.createdAt, order: 0, kind: "INVOICE" as const, ref: i.saleNo, refId: i.id, description: i.dueDate ? `Credit sale (due ${i.dueDate.toISOString().slice(0, 10)})` : "Sale", debit: i.total, credit: new D(0) })),
    ...payments.map((p) => ({
      at: p.receivedAt,
      order: 1, // an invoice sorts before the payment taken at the same moment
      kind: "PAYMENT" as const,
      ref: p.paymentNo,
      refId: p.id,
      description: `${p.source === "AT_SALE" ? "Paid at sale" : "Payment received"} · ${METHOD[p.method] ?? p.method}${p.reference ? ` (${p.reference})` : ""}`,
      debit: new D(0),
      credit: p.amount,
    })),
    ...reversals.flatMap((r) => {
      const at = r.decidedAt ?? new Date(0);
      const rows: RawLine[] = [{ at, order: 2, kind: "RETURN" as const, ref: r.reversalNo, refId: r.id, description: `${r.kind === "CANCEL" ? "Sale cancelled" : "Goods returned"} (${r.sale.saleNo})`, debit: new D(0), credit: r.returnValue }];
      if (r.refundAmount.gt(0)) rows.push({ at, order: 3, kind: "REFUND" as const, ref: r.reversalNo, refId: `${r.id}-refund`, description: `Refund paid to customer${r.refundMethod ? ` (${METHOD[r.refundMethod] ?? r.refundMethod})` : ""}`, debit: r.refundAmount, credit: new D(0) });
      return rows;
    }),
  ].sort((a, b) => a.at.getTime() - b.at.getTime() || a.order - b.order || a.ref.localeCompare(b.ref));

  let running = opening;
  const lines: StatementLine[] = raw.map(({ order: _o, ...l }) => {
    running = running.plus(l.debit).minus(l.credit);
    return { ...l, balance: running };
  });
  return { opening, lines, closing: running };
}
