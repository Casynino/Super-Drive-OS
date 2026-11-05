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

/** Outstanding balance for every customer that owes something, as { customerId: amount }. */
export async function outstandingByCustomer(tx: Pick<Tx, "$queryRaw">) {
  const rows = await tx.$queryRaw<{ customerId: string; s: Prisma.Decimal | string }[]>`
    SELECT "customerId", SUM(${owedSql()}) AS s
      FROM "Sale" WHERE "customerId" IS NOT NULL AND "status" = 'COMPLETED'
     GROUP BY "customerId" HAVING SUM(${owedSql()}) > 0`;
  return new Map(rows.map((r) => [r.customerId, new D(r.s.toString())]));
}
