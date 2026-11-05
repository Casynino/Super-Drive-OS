// The cash ledger. Every movement of money into or out of the till, mobile money or the bank is ONE signed row
// here, written in the same database transaction as the record that caused it (sale payment, collection, refund,
// expense, deposit, ...). The balance of an account is always the sum of its rows - it is never stored, so it
// cannot drift. (account, type, source record) is unique, so the same event can never be counted twice.
import { randomUUID } from "node:crypto";
import { Prisma, type CashTxType, type PaymentMethod } from "@/generated/prisma/client";
import type { Tx } from "@/lib/inventory/engine";

const D = Prisma.Decimal;
export type Dec = Prisma.Decimal;

const TZ = "Africa/Dar_es_Salaam";

/** A problem the person can fix. fieldErrors keys match form field names. */
export class CashError extends Error {
  constructor(
    message: string,
    public fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}

/** The shop's calendar day ("YYYY-MM-DD") for a moment in time. Business days follow Tanzania time, not the server's clock. */
export const businessDay = (d: Date = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
/** A "YYYY-MM-DD" day as the Date Prisma stores in a DATE column. */
export const dayToDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
export const dateToDay = (d: Date) => d.toISOString().slice(0, 10);

export const ACCOUNT_NAME: Record<PaymentMethod, string> = { CASH: "Cash on hand", MOBILE_MONEY: "Mobile money", BANK: "Bank account" };
export const METHODS: PaymentMethod[] = ["CASH", "MOBILE_MONEY", "BANK"];

export const TX_LABEL: Record<CashTxType, string> = {
  SALE_PAYMENT: "Sale payment",
  COLLECTION: "Debt collected",
  REFUND: "Refund to customer",
  EXPENSE: "Expense",
  EXPENSE_REVERSAL: "Expense reversed",
  SUPPLIER_PAYMENT: "Paid to supplier",
  DEPOSIT_OUT: "Deposited to bank",
  DEPOSIT_IN: "Bank deposit received",
  WITHDRAWAL: "Withdrawal",
  ADJUSTMENT: "Correction",
  OPENING_BALANCE: "Opening balance",
  CLOSING_DIFFERENCE: "Count difference",
};

export async function defaultLocationId(tx: Pick<Tx, "location">) {
  const l = (await tx.location.findFirst({ where: { isDefault: true }, select: { id: true } })) ?? (await tx.location.findFirst({ where: { status: "ACTIVE", type: { not: "RESELLER" } }, orderBy: { createdAt: "asc" }, select: { id: true } }));
  if (!l) throw new CashError("No stock location is set up.");
  return l.id;
}

/** The account for a payment method at a location (created the first time it is needed). */
export async function getAccount(tx: Tx, locationId: string, method: PaymentMethod) {
  const found = await tx.cashAccount.findUnique({ where: { locationId_method: { locationId, method } } });
  if (found) return found;
  await tx.$executeRaw`INSERT INTO "CashAccount" ("id", "locationId", "method", "name") VALUES (${randomUUID()}, ${locationId}, ${method}::"PaymentMethod", ${ACCOUNT_NAME[method]}) ON CONFLICT ("locationId", "method") DO NOTHING`;
  return tx.cashAccount.findUniqueOrThrow({ where: { locationId_method: { locationId, method } } });
}

export type PostCashInput = {
  locationId: string;
  method: PaymentMethod;
  type: CashTxType;
  /** Signed: money in is positive, money out is negative. */
  amount: Dec;
  referenceType: string;
  referenceId: string;
  referenceNo?: string | null;
  description?: string | null;
  userId: string;
  at?: Date;
  closingId?: string | null;
};

export async function postCash(tx: Tx, i: PostCashInput) {
  const account = await getAccount(tx, i.locationId, i.method);
  return tx.cashTransaction.create({
    data: {
      accountId: account.id,
      type: i.type,
      amount: i.amount,
      businessDate: dayToDate(businessDay(i.at)),
      referenceType: i.referenceType,
      referenceId: i.referenceId,
      referenceNo: i.referenceNo ?? null,
      description: i.description ?? null,
      userId: i.userId,
      closingId: i.closingId ?? null,
    },
  });
}

/** Money received from a customer lands in the account of the method used. Called wherever a Payment is created. */
export async function recordPaymentCash(
  tx: Tx,
  p: { id: string; paymentNo: string; source: "AT_SALE" | "DEBT_COLLECTION"; method: PaymentMethod; amount: Dec },
  by: { locationId?: string | null; userId: string },
) {
  return postCash(tx, {
    locationId: by.locationId ?? (await defaultLocationId(tx)),
    method: p.method,
    type: p.source === "AT_SALE" ? "SALE_PAYMENT" : "COLLECTION",
    amount: p.amount,
    referenceType: "Payment",
    referenceId: p.id,
    referenceNo: p.paymentNo,
    userId: by.userId,
  });
}

/** Money paid back to a customer leaves the account of the refund method. */
export async function recordRefundCash(
  tx: Tx,
  r: { id: string; reversalNo: string; method: PaymentMethod; amount: Dec },
  by: { locationId: string; userId: string },
) {
  return postCash(tx, {
    locationId: by.locationId,
    method: r.method,
    type: "REFUND",
    amount: r.amount.neg(),
    referenceType: "SaleReversal",
    referenceId: r.id,
    referenceNo: r.reversalNo,
    description: "Refund to customer",
    userId: by.userId,
  });
}

/** The current balance of an account (sum of every ledger row). */
export async function accountBalance(tx: Pick<Tx, "$queryRaw">, accountId: string): Promise<Dec> {
  const rows = await tx.$queryRaw<{ s: Dec | null }[]>`SELECT SUM("amount") AS s FROM "CashTransaction" WHERE "accountId" = ${accountId}`;
  return new D(rows[0]?.s ?? 0);
}

/** Row-locks an account so two people cannot spend the same money (deposits, withdrawals, expenses). */
export async function lockAccount(tx: Pick<Tx, "$queryRaw">, accountId: string) {
  await tx.$queryRaw`SELECT "id" FROM "CashAccount" WHERE "id" = ${accountId} FOR UPDATE`;
}

/** Throws a friendly error when taking `amount` out of the account would leave less than nothing. */
export async function assertCanSpend(tx: Tx, accountId: string, method: PaymentMethod, amount: Dec, field: string) {
  await lockAccount(tx, accountId);
  const balance = await accountBalance(tx, accountId);
  if (amount.gt(balance)) {
    const label = ACCOUNT_NAME[method].toLowerCase();
    const fmt = (v: Dec) => new Intl.NumberFormat("en-US").format(Number(v.toString()));
    throw new CashError(
      `There is only ${fmt(balance)} in ${label} according to the records, which is not enough for ${fmt(amount)}. If the money really is there, record the opening balance or a correction in Cash & Accounts first.`,
      { [field]: `Only ${fmt(balance)} available.` },
    );
  }
}

/** Balances of all three accounts of a location, plus what moved in and out so far today. */
export async function getBalances(db: Pick<Tx, "$queryRaw">, locationId: string, today = businessDay()) {
  const rows = await db.$queryRaw<{ method: PaymentMethod; balance: Dec | null; inToday: Dec | null; outToday: Dec | null }[]>`
    SELECT a."method", SUM(t."amount") AS balance,
           SUM(CASE WHEN t."businessDate" = ${today}::date AND t."amount" > 0 THEN t."amount" ELSE 0 END) AS "inToday",
           SUM(CASE WHEN t."businessDate" = ${today}::date AND t."amount" < 0 THEN -t."amount" ELSE 0 END) AS "outToday"
      FROM "CashAccount" a LEFT JOIN "CashTransaction" t ON t."accountId" = a."id"
     WHERE a."locationId" = ${locationId}
     GROUP BY a."method"`;
  const byMethod = new Map(rows.map((r) => [r.method, r]));
  return METHODS.map((method) => {
    const r = byMethod.get(method);
    return { method, name: ACCOUNT_NAME[method], balance: new D(r?.balance ?? 0), inToday: new D(r?.inToday ?? 0), outToday: new D(r?.outToday ?? 0) };
  });
}
