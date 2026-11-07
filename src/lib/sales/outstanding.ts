import { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/inventory/engine";
import { owedSql } from "./owed";

const D = Prisma.Decimal;

/** What one customer owes: the unpaid part of their completed sales. Always calculated, never stored. */
export async function customerOutstanding(tx: Pick<Tx, "$queryRaw">, customerId: string) {
  const rows = await tx.$queryRaw<{ s: Prisma.Decimal | string | null }[]>`
    SELECT COALESCE(SUM(${owedSql()}), 0) AS s
      FROM "Sale" WHERE "customerId" = ${customerId} AND "status" = 'COMPLETED'`;
  return new D((rows[0]?.s ?? 0).toString());
}

/** How many orders each customer still has unpaid (completed, something still owed): { customerId: count }. */
export async function openOrdersByCustomer(tx: Pick<Tx, "$queryRaw">) {
  const rows = await tx.$queryRaw<{ customerId: string; n: bigint | number }[]>`
    SELECT "customerId", COUNT(*) AS n
      FROM "Sale" WHERE "customerId" IS NOT NULL AND "status" = 'COMPLETED' AND ${owedSql()} > 0
     GROUP BY "customerId"`;
  return new Map(rows.map((r) => [r.customerId, Number(r.n)]));
}

/** The business "today" (Tanzania), as YYYY-MM-DD: due dates are compared against it. */
export const businessDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(new Date());

/** What one customer owes on invoices that are past their due date (amount) and the oldest such due date. */
export async function customerOverdue(tx: Pick<Tx, "$queryRaw">, customerId: string, today: string = businessDay()) {
  const rows = await tx.$queryRaw<{ s: Prisma.Decimal | string | null; d: Date | null }[]>`
    SELECT COALESCE(SUM(${owedSql()}), 0) AS s, MIN("dueDate") AS d
      FROM "Sale"
     WHERE "customerId" = ${customerId} AND "status" = 'COMPLETED' AND "dueDate" IS NOT NULL AND "dueDate" < ${today}::date AND ${owedSql()} > 0`;
  return { amount: new D((rows[0]?.s ?? 0).toString()), since: rows[0]?.d ?? null };
}

/** The same for every customer that has something late: { customerId: { amount, since } }. */
export async function overdueByCustomer(tx: Pick<Tx, "$queryRaw">, today: string = businessDay()) {
  const rows = await tx.$queryRaw<{ customerId: string; s: Prisma.Decimal | string; d: Date }[]>`
    SELECT "customerId", SUM(${owedSql()}) AS s, MIN("dueDate") AS d
      FROM "Sale"
     WHERE "customerId" IS NOT NULL AND "status" = 'COMPLETED' AND "dueDate" IS NOT NULL AND "dueDate" < ${today}::date AND ${owedSql()} > 0
     GROUP BY "customerId"`;
  return new Map(rows.map((r) => [r.customerId, { amount: new D(r.s.toString()), since: r.d }]));
}

/** Outstanding balance for every customer that owes something, as { customerId: amount }. */
export async function outstandingByCustomer(tx: Pick<Tx, "$queryRaw">) {
  const rows = await tx.$queryRaw<{ customerId: string; s: Prisma.Decimal | string }[]>`
    SELECT "customerId", SUM(${owedSql()}) AS s
      FROM "Sale" WHERE "customerId" IS NOT NULL AND "status" = 'COMPLETED'
     GROUP BY "customerId" HAVING SUM(${owedSql()}) > 0`;
  return new Map(rows.map((r) => [r.customerId, new D(r.s.toString())]));
}
