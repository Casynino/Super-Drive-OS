// What was COLLECTED on the shop's mobile-money and bank accounts since the last closing: customer payments at the sale and debts paid,
// minus refunds. Read-only. It is what the person closing sees ("nothing to count") and what the Director's report shows; it is NOT the
// account balance (the balance stays on the Director's side), and a cash deposit or a move between accounts never counts as collected.
// It reads the same open ledger rows the closing will take, so after a closing it starts again from zero.
import { Prisma, type PaymentMethod } from "@/generated/prisma/client";
import type { Dec, Tx } from "@/lib/inventory/engine";

export type CollectedRow = { accountId: string; name: string; method: PaymentMethod; amount: Dec };

export async function getCollectedSinceClosing(tx: Pick<Tx, "$queryRaw">, locationId: string, day: string): Promise<CollectedRow[]> {
  const rows = await tx.$queryRaw<{ id: string; name: string; method: PaymentMethod; v: Dec | null }[]>`
    SELECT a."id", a."name", a."method", COALESCE(SUM(t."amount"), 0) AS v
      FROM "CashAccount" a
      LEFT JOIN "CashTransaction" t ON t."accountId" = a."id" AND t."closingId" IS NULL AND t."businessDate" <= ${day}::date AND t."type" IN ('SALE_PAYMENT', 'COLLECTION', 'REFUND')
     WHERE a."locationId" = ${locationId} AND a."method" <> 'CASH' AND a."status" = 'ACTIVE'
     GROUP BY a."id", a."name", a."method"
     ORDER BY a."method", a."isDefault" DESC, a."name"`;
  return rows.map((r) => ({ accountId: r.id, name: r.name, method: r.method, amount: new Prisma.Decimal(r.v ?? 0) }));
}
