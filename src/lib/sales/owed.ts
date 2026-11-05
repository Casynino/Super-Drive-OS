import { Prisma } from "@/generated/prisma/client";

type Dec = Prisma.Decimal;
export type OwedInputs = { total: Dec; returnedTotal: Dec; amountPaid: Dec; refundedTotal: Dec };

// An invoice keeps its original total forever. Returns lower what is due (returnedTotal); refunds lower what
// has been kept (refundedTotal). So:  owed = (total - returned) - (paid - refunded).
export const netTotal = (s: Pick<OwedInputs, "total" | "returnedTotal">) => s.total.minus(s.returnedTotal);
export const netPaid = (s: Pick<OwedInputs, "amountPaid" | "refundedTotal">) => s.amountPaid.minus(s.refundedTotal);
export const owedOf = (s: OwedInputs) => netTotal(s).minus(netPaid(s));

/** The same calculation for raw SQL. Pass the table alias (default: unqualified columns). */
export const owedSql = (alias?: string) => {
  const c = (name: string) => (alias ? `${alias}."${name}"` : `"${name}"`);
  return Prisma.raw(`(${c("total")} - ${c("returnedTotal")} - ${c("amountPaid")} + ${c("refundedTotal")})`);
};
