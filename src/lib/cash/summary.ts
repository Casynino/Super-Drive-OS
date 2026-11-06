// What the ledger says about a period, in the words the owner uses. Everything comes from the cash ledger (the one record
// of every movement of money), so Income, Expenses and the General Ledger can never disagree:
//   Income   = money received at sales and on debts, minus refunds paid back
//   Spent    = expenses (less any reversed), supplier payments, and what the owner took out
//   Left     = income minus everything spent (plus or minus corrections found at counting)
// Opening balances and bank deposits are not income or spending: a deposit only moves cash into a bank account.
import { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/inventory/engine";

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

export type MoneySummary = {
  /** money received at sales and on debts */
  received: Dec;
  /** money paid back to customers (a positive number) */
  refunds: Dec;
  /** how many payments were received */
  payments: number;
  /** received minus refunds */
  income: Dec;
  /** expenses paid, less expenses reversed */
  expenses: Dec;
  suppliers: Dec;
  /** taken out by the owner (withdrawals) */
  withdrawals: Dec;
  /** count differences and authorised corrections (+ added, − removed) */
  corrections: Dec;
  spent: Dec;
  /** income − spent + corrections */
  left: Dec;
  /** bank deposits (cash into a bank account) and opening balances: moved, not earned or spent */
  moved: Dec;
  byAccount: { id: string; name: string; accountNumber: string | null; method: string; income: Dec }[];
};

export type Period = { from?: string | null; to?: string | null };

const sum = (v: Dec | null | undefined) => new D(v ?? 0);

export async function getMoneySummary(db: Pick<Tx, "$queryRaw">, locationId: string, p: Period = {}): Promise<MoneySummary> {
  const dates = Prisma.sql`${p.from ? Prisma.sql`AND t."businessDate" >= ${p.from}::date` : Prisma.empty} ${p.to ? Prisma.sql`AND t."businessDate" <= ${p.to}::date` : Prisma.empty}`;
  const [t, byAccount] = await Promise.all([
    db.$queryRaw<(Record<"received" | "refunds" | "expenses" | "reversed" | "suppliers" | "withdrawals" | "corrections" | "moved", Dec | null> & { payments: bigint })[]>`
      SELECT COUNT(*) FILTER (WHERE t."type" IN ('SALE_PAYMENT', 'COLLECTION')) AS payments,
             SUM(t."amount") FILTER (WHERE t."type" IN ('SALE_PAYMENT', 'COLLECTION')) AS received,
             -SUM(t."amount") FILTER (WHERE t."type" = 'REFUND') AS refunds,
             -SUM(t."amount") FILTER (WHERE t."type" = 'EXPENSE') AS expenses,
             SUM(t."amount") FILTER (WHERE t."type" = 'EXPENSE_REVERSAL') AS reversed,
             -SUM(t."amount") FILTER (WHERE t."type" = 'SUPPLIER_PAYMENT') AS suppliers,
             -SUM(t."amount") FILTER (WHERE t."type" = 'WITHDRAWAL') AS withdrawals,
             SUM(t."amount") FILTER (WHERE t."type" IN ('ADJUSTMENT', 'CLOSING_DIFFERENCE')) AS corrections,
             SUM(ABS(t."amount")) FILTER (WHERE t."type" IN ('DEPOSIT_IN', 'OPENING_BALANCE')) AS moved
        FROM "CashTransaction" t JOIN "CashAccount" a ON a."id" = t."accountId"
       WHERE a."locationId" = ${locationId} ${dates}`,
    db.$queryRaw<{ id: string; name: string; accountNumber: string | null; method: string; income: Dec | null }[]>`
      SELECT a."id", a."name", a."accountNumber", a."method"::text AS method,
             SUM(t."amount") FILTER (WHERE t."type" IN ('SALE_PAYMENT', 'COLLECTION', 'REFUND')) AS income
        FROM "CashAccount" a LEFT JOIN "CashTransaction" t ON t."accountId" = a."id" ${dates}
       WHERE a."locationId" = ${locationId}
       GROUP BY a."id" ORDER BY income DESC NULLS LAST, a."name"`,
  ]);
  const r = t[0];
  const received = sum(r?.received);
  const refunds = sum(r?.refunds);
  const expenses = sum(r?.expenses).minus(sum(r?.reversed));
  const suppliers = sum(r?.suppliers);
  const withdrawals = sum(r?.withdrawals);
  const corrections = sum(r?.corrections);
  const income = received.minus(refunds);
  const spent = expenses.plus(suppliers).plus(withdrawals);
  return {
    received,
    refunds,
    payments: Number(r?.payments ?? 0),
    income,
    expenses,
    suppliers,
    withdrawals,
    corrections,
    spent,
    left: income.minus(spent).plus(corrections),
    moved: sum(r?.moved),
    byAccount: byAccount.map((a) => ({ id: a.id, name: a.name, accountNumber: a.accountNumber, method: a.method, income: sum(a.income) })),
  };
}

export type TillToday = { received: Dec; expenses: Dec; deposited: Dec; otherOut: Dec; balance: Dec };

/**
 * The shop's cash for one day: what came in as cash, what was used for expenses, what was taken to the bank, and what is still at the
 * shop (the till's balance). Cash stays at the shop until it is deposited; a deposit takes it out of the till and into the bank.
 */
export async function getTillToday(db: Pick<Tx, "$queryRaw">, locationId: string, today: string): Promise<TillToday> {
  const [day, bal] = await Promise.all([
    db.$queryRaw<Record<"received" | "expenses" | "reversed" | "deposited" | "otherOut", Dec | null>[]>`
      SELECT SUM(t."amount") FILTER (WHERE t."type" IN ('SALE_PAYMENT', 'COLLECTION')) AS received,
             -SUM(t."amount") FILTER (WHERE t."type" = 'EXPENSE') AS expenses,
             SUM(t."amount") FILTER (WHERE t."type" = 'EXPENSE_REVERSAL') AS reversed,
             -SUM(t."amount") FILTER (WHERE t."type" = 'DEPOSIT_OUT') AS deposited,
             -SUM(t."amount") FILTER (WHERE t."type" IN ('REFUND', 'SUPPLIER_PAYMENT', 'WITHDRAWAL')) AS "otherOut"
        FROM "CashTransaction" t JOIN "CashAccount" a ON a."id" = t."accountId"
       WHERE a."locationId" = ${locationId} AND a."method" = 'CASH' AND t."businessDate" = ${today}::date`,
    db.$queryRaw<{ s: Dec | null }[]>`
      SELECT SUM(t."amount") AS s FROM "CashTransaction" t JOIN "CashAccount" a ON a."id" = t."accountId" WHERE a."locationId" = ${locationId} AND a."method" = 'CASH'`,
  ]);
  const r = day[0];
  return { received: sum(r?.received), expenses: sum(r?.expenses).minus(sum(r?.reversed)), deposited: sum(r?.deposited), otherOut: sum(r?.otherOut), balance: sum(bal[0]?.s) };
}
