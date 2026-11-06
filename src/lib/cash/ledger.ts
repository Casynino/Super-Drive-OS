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
  TRANSFER_OUT: "Moved to another account",
  TRANSFER_IN: "Moved from another account",
};

export async function defaultLocationId(tx: Pick<Tx, "location">) {
  const l = (await tx.location.findFirst({ where: { isDefault: true }, select: { id: true } })) ?? (await tx.location.findFirst({ where: { status: "ACTIVE", type: { not: "RESELLER" } }, orderBy: { createdAt: "asc" }, select: { id: true } }));
  if (!l) throw new CashError("No stock location is set up.");
  return l.id;
}

export type AccountInfo = { id: string; locationId: string; method: PaymentMethod; name: string; accountNumber: string | null; holderName: string | null; status: "ACTIVE" | "INACTIVE"; isDefault: boolean };

/** "CRDB Bank · 0152841983800": the name people recognise, with the number when there is one. */
export const accountLabel = (a: { name: string; accountNumber?: string | null }) => (a.accountNumber ? `${a.name} · ${a.accountNumber}` : a.name);

/** The DEFAULT account of a payment method at a location (created the first time it is needed). */
export async function getAccount(tx: Tx, locationId: string, method: PaymentMethod) {
  const found = await tx.cashAccount.findFirst({ where: { locationId, method, isDefault: true } });
  if (found) return found;
  await tx.$executeRaw`INSERT INTO "CashAccount" ("id", "locationId", "method", "name", "isDefault") VALUES (${randomUUID()}, ${locationId}, ${method}::"PaymentMethod", ${ACCOUNT_NAME[method]}, true) ON CONFLICT ("locationId", "method") WHERE "isDefault" DO NOTHING`;
  return tx.cashAccount.findFirstOrThrow({ where: { locationId, method, isDefault: true } });
}

/**
 * The account a movement of money uses. With an `accountId` it must be an account of that location and method, and open
 * (unless `allowClosed`, for putting money back where it came from). Without one, the default account of the method is used,
 * but only when the method has a single open account: when there are several, the person has to say which one
 * (`lenient` takes the default instead, for flows that have no screen to ask on, such as refunds).
 */
export async function resolveAccount(tx: Tx, o: { locationId: string; method: PaymentMethod; accountId?: string | null; field?: string; lenient?: boolean; allowClosed?: boolean }) {
  const field = o.field ?? "accountId";
  if (o.accountId) {
    const a = await tx.cashAccount.findUnique({ where: { id: o.accountId } });
    if (!a || a.locationId !== o.locationId) throw new CashError("This account does not exist here.", { [field]: "Choose an account from the list." });
    if (a.method !== o.method) throw new CashError(`${a.name} is not a ${ACCOUNT_NAME[o.method].toLowerCase()}.`, { [field]: "This account does not match the payment method." });
    if (a.status !== "ACTIVE" && !o.allowClosed) throw new CashError(`${a.name} is closed and cannot be used any more.`, { [field]: "This account is closed." });
    return a;
  }
  const open = await tx.cashAccount.findMany({ where: { locationId: o.locationId, method: o.method, status: "ACTIVE" }, select: { id: true }, take: 2 });
  if (open.length > 1 && !o.lenient) throw new CashError(`Choose which account the money goes through (${ACCOUNT_NAME[o.method].toLowerCase()}).`, { [field]: "Choose the account." });
  return getAccount(tx, o.locationId, o.method);
}

/** The accounts of a location for pickers: the till first, then mobile money, then banks; the default of each method first. */
export async function listAccounts(db: Pick<Tx, "cashAccount">, locationId?: string, opts: { includeClosed?: boolean } = {}): Promise<AccountInfo[]> {
  const rows = await db.cashAccount.findMany({ where: { ...(locationId ? { locationId } : {}), ...(opts.includeClosed ? {} : { status: "ACTIVE" }) }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  const rank = (m: PaymentMethod) => METHODS.indexOf(m);
  return rows.sort((x, y) => rank(x.method) - rank(y.method)).map((r) => ({ id: r.id, locationId: r.locationId, method: r.method, name: r.name, accountNumber: r.accountNumber, holderName: r.holderName, status: r.status, isDefault: r.isDefault }));
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
  /** the exact account; empty = the default account of the method (see resolveAccount) */
  accountId?: string | null;
  field?: string;
  lenient?: boolean;
  allowClosed?: boolean;
};

export async function postCash(tx: Tx, i: PostCashInput) {
  const account = await resolveAccount(tx, { locationId: i.locationId, method: i.method, accountId: i.accountId, field: i.field, lenient: i.lenient, allowClosed: i.allowClosed });
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
  p: { id: string; paymentNo: string; source: "AT_SALE" | "DEBT_COLLECTION"; method: PaymentMethod; amount: Dec; accountId?: string | null },
  by: { locationId?: string | null; userId: string },
) {
  return postCash(tx, {
    locationId: by.locationId ?? (await defaultLocationId(tx)),
    method: p.method,
    accountId: p.accountId,
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
  r: { id: string; reversalNo: string; method: PaymentMethod; amount: Dec; accountId?: string | null },
  by: { locationId: string; userId: string },
) {
  return postCash(tx, {
    locationId: by.locationId,
    method: r.method,
    accountId: r.accountId,
    lenient: true,
    allowClosed: true,
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
    const label = (await tx.cashAccount.findUnique({ where: { id: accountId }, select: { name: true } }))?.name ?? ACCOUNT_NAME[method].toLowerCase();
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

export type AccountBalance = AccountInfo & { balance: Dec; inToday: Dec; outToday: Dec; movements: number; lastAt: Date | null };

/** Every account of a location with its balance (the sum of its ledger rows) and what moved today. Closed accounts are listed only while they hold money or have history. */
export async function getAccountBalances(db: Pick<Tx, "$queryRaw">, locationId: string, today = businessDay()): Promise<AccountBalance[]> {
  const rows = await db.$queryRaw<
    { id: string; locationId: string; method: PaymentMethod; name: string; accountNumber: string | null; holderName: string | null; status: "ACTIVE" | "INACTIVE"; isDefault: boolean; balance: Dec | null; inToday: Dec | null; outToday: Dec | null; movements: bigint; lastAt: Date | null }[]
  >`
    SELECT a."id", a."locationId", a."method", a."name", a."accountNumber", a."holderName", a."status", a."isDefault",
           SUM(t."amount") AS balance,
           SUM(CASE WHEN t."businessDate" = ${today}::date AND t."amount" > 0 THEN t."amount" ELSE 0 END) AS "inToday",
           SUM(CASE WHEN t."businessDate" = ${today}::date AND t."amount" < 0 THEN -t."amount" ELSE 0 END) AS "outToday",
           COUNT(t."id") AS movements, MAX(t."createdAt") AS "lastAt"
      FROM "CashAccount" a LEFT JOIN "CashTransaction" t ON t."accountId" = a."id"
     WHERE a."locationId" = ${locationId}
     GROUP BY a."id"`;
  const rank = (m: PaymentMethod) => METHODS.indexOf(m);
  return rows
    .map((r) => ({ ...r, balance: new D(r.balance ?? 0), inToday: new D(r.inToday ?? 0), outToday: new D(r.outToday ?? 0), movements: Number(r.movements) }))
    .filter((r) => r.status === "ACTIVE" || r.movements > 0)
    .sort((x, y) => rank(x.method) - rank(y.method) || Number(y.isDefault) - Number(x.isDefault) || (x.name < y.name ? -1 : 1));
}
