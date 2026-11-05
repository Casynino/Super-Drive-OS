import { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

export type StatementLine = {
  at: Date;
  kind: "INVOICE" | "PAYMENT";
  ref: string;
  refId: string;
  description: string;
  debit: Dec; // increases what the customer owes
  credit: Dec; // reduces it
  balance: Dec; // running balance after this line
};

export type Statement = { opening: Dec; lines: StatementLine[]; closing: Dec };

/**
 * Chronological account statement. Balance = invoices − payments received. A negative balance means the
 * customer has paid in advance. Cash sales to a registered customer appear as an invoice and its payment,
 * which cancel out, so the statement always agrees with what is really owed.
 */
export async function getStatement(db: Pick<Db, "sale" | "payment">, customerId: string, from?: Date, to?: Date): Promise<Statement> {
  const range: Prisma.DateTimeFilter | undefined = from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : undefined;

  const [invoices, payments, beforeInv, beforePay] = await Promise.all([
    db.sale.findMany({
      where: { customerId, status: "COMPLETED", ...(range ? { createdAt: range } : {}) },
      select: { id: true, saleNo: true, createdAt: true, total: true, dueDate: true },
    }),
    db.payment.findMany({
      where: { customerId, ...(range ? { receivedAt: range } : {}) },
      select: { id: true, paymentNo: true, receivedAt: true, amount: true, method: true, source: true, reference: true },
    }),
    from ? db.sale.aggregate({ where: { customerId, status: "COMPLETED", createdAt: { lt: from } }, _sum: { total: true } }) : null,
    from ? db.payment.aggregate({ where: { customerId, receivedAt: { lt: from } }, _sum: { amount: true } }) : null,
  ]);

  const opening = (beforeInv?._sum.total ?? new D(0)).minus(beforePay?._sum.amount ?? new D(0));
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
  ].sort((a, b) => a.at.getTime() - b.at.getTime() || a.order - b.order || a.ref.localeCompare(b.ref));

  let running = opening;
  const lines: StatementLine[] = raw.map(({ order: _o, ...l }) => {
    running = running.plus(l.debit).minus(l.credit);
    return { ...l, balance: running };
  });
  return { opening, lines, closing: running };
}
