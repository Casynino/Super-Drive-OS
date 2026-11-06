import { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/inventory/engine";

const D = Prisma.Decimal;

export type CashSettings = {
  /** Expenses up to this amount are recorded straight away; anything above needs the owner first. 0 = every expense needs approval. */
  expenseApprovalLimit: Prisma.Decimal;
  /** A cash count that differs from the expected amount by more than this needs the owner's review. 0 = any difference. */
};

const amount = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? new D(n) : new D(0);
};

export async function getCashSettings(db: Pick<Tx, "setting">): Promise<CashSettings> {
  const rows = await db.setting.findMany({ where: { key: { in: ["expenseApprovalLimit"] } } });
  const m = new Map(rows.map((r) => [r.key, r.value]));
  return { expenseApprovalLimit: amount(m.get("expenseApprovalLimit")) };
}
