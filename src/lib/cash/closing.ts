// Daily closing. The attendant counts the cash; the system does all the arithmetic from the ledger.
//
//   expected cash = opening cash + cash in - cash out   (every term is a cash-ledger row, so it is traceable)
//   difference    = counted cash - expected cash        (negative = shortage)
//
// Submitting is one transaction that: stamps every open ledger row with this closing (a row can belong to only one),
// books the difference so the ledger balance equals the counted cash from now on (carry-forward), optionally deposits
// part of the cash to the bank, and LOCKS the figures (database trigger). Corrections afterwards are authorised cash
// adjustments, never edits. A difference above the owner's tolerance sends the closing to the owner for review.
//
// Lock order: cash account row → document counters. Ledger rows written by other transactions while a closing runs are
// not part of it (it only stamps the rows it read); they simply belong to the next closing.
import { Prisma, type CashTxType, type PaymentMethod } from "@/generated/prisma/client";
import { nextDocumentNo, type Dec, type Tx } from "@/lib/inventory/engine";
import { parseMoney } from "@/lib/money";
import { postDeposit } from "./deposits";
import { CashError, METHODS, businessDay, dateToDay, dayToDate, getAccount, lockAccount, postCash } from "./ledger";

const D = Prisma.Decimal;

type OpenRow = { id: string; method: PaymentMethod; type: CashTxType; amount: Dec };

export type MethodTotals = Record<PaymentMethod, string>;
export type ClosingSummary = {
  businessDate: string;
  sales: { count: number; total: string; paidByMethod: MethodTotals; creditGiven: string; returnsCount: number; returnsValue: string };
  collections: { total: string; byMethod: MethodTotals };
  expenses: { total: string; byCategory: { name: string; amount: string }[] };
  cash: { opening: string; salesIn: string; collectionsIn: string; refundsOut: string; expensesOut: string; withdrawals: string; depositsOut: string; corrections: string; expected: string };
  accounts: { method: PaymentMethod; opening: string; in: string; out: string; balance: string }[];
  entries: number;
};

const zeroBy = (): Record<PaymentMethod, Dec> => ({ CASH: new D(0), MOBILE_MONEY: new D(0), BANK: new D(0) });
const strBy = (m: Record<PaymentMethod, Dec>): MethodTotals => ({ CASH: m.CASH.toString(), MOBILE_MONEY: m.MOBILE_MONEY.toString(), BANK: m.BANK.toString() });

/** Ledger rows of this location that no closing has taken yet, up to and including `day`. */
async function loadOpenRows(tx: Pick<Tx, "$queryRaw">, locationId: string, day: string): Promise<OpenRow[]> {
  const rows = await tx.$queryRaw<{ id: string; method: PaymentMethod; type: CashTxType; amount: Dec }[]>`
    SELECT t."id", a."method", t."type", t."amount"
      FROM "CashTransaction" t JOIN "CashAccount" a ON a."id" = t."accountId"
     WHERE a."locationId" = ${locationId} AND t."closingId" IS NULL AND t."businessDate" <= ${day}::date
     ORDER BY t."createdAt", t."id"`;
  return rows.map((r) => ({ ...r, amount: new D(r.amount) }));
}

/** What each account held after the last closing (the sum of all rows already stamped). */
async function stampedBalances(tx: Pick<Tx, "$queryRaw">, locationId: string) {
  const rows = await tx.$queryRaw<{ method: PaymentMethod; s: Dec | null }[]>`
    SELECT a."method", SUM(t."amount") AS s
      FROM "CashTransaction" t JOIN "CashAccount" a ON a."id" = t."accountId"
     WHERE a."locationId" = ${locationId} AND t."closingId" IS NOT NULL GROUP BY a."method"`;
  const out = zeroBy();
  for (const r of rows) out[r.method] = new D(r.s ?? 0);
  return out;
}

async function salesStats(tx: Pick<Tx, "$queryRaw">, locationId: string, day: string) {
  const [s, p, r] = await Promise.all([
    tx.$queryRaw<{ n: bigint; total: Dec | null; credit: Dec | null }[]>`
      SELECT COUNT(*) AS n, SUM(s."total") AS total, SUM(GREATEST(s."total" - COALESCE(a.paid, 0), 0)) AS credit
        FROM "Sale" s
        LEFT JOIN (SELECT pa."saleId", SUM(pa."amount") AS paid FROM "PaymentAllocation" pa JOIN "Payment" p ON p."id" = pa."paymentId" WHERE p."source" = 'AT_SALE' GROUP BY 1) a ON a."saleId" = s."id"
       WHERE s."locationId" = ${locationId} AND s."status" = 'COMPLETED'
         AND (s."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Dar_es_Salaam')::date = ${day}::date`,
    tx.$queryRaw<{ method: PaymentMethod; v: Dec | null }[]>`
      SELECT p."method", SUM(p."amount") AS v FROM "Payment" p
       WHERE p."source" = 'AT_SALE' AND (p."receivedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Dar_es_Salaam')::date = ${day}::date GROUP BY 1`,
    tx.$queryRaw<{ n: bigint; v: Dec | null }[]>`
      SELECT COUNT(*) AS n, SUM(r."returnValue") AS v FROM "SaleReversal" r JOIN "Sale" s ON s."id" = r."saleId"
       WHERE r."status" = 'COMPLETED' AND s."locationId" = ${locationId}
         AND (r."decidedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Dar_es_Salaam')::date = ${day}::date`,
  ]);
  const paid = zeroBy();
  for (const x of p) paid[x.method] = new D(x.v ?? 0);
  return {
    count: Number(s[0]?.n ?? 0),
    total: new D(s[0]?.total ?? 0),
    credit: new D(s[0]?.credit ?? 0),
    paid,
    returnsCount: Number(r[0]?.n ?? 0),
    returnsValue: new D(r[0]?.v ?? 0),
  };
}

/** Builds the whole day summary from the rows that will be (or were) stamped. The same code feeds the preview and the submit. */
async function summarize(tx: Pick<Tx, "$queryRaw">, rows: OpenRow[], stamped: Record<PaymentMethod, Dec>, locationId: string, day: string): Promise<{ summary: ClosingSummary; expectedCash: Dec; openingCash: Dec }> {
  const opening = { ...stamped };
  const inBy = zeroBy();
  const outBy = zeroBy();
  const collections = zeroBy();
  let salesIn = new D(0), collectionsIn = new D(0), refundsOut = new D(0), expensesOut = new D(0), withdrawals = new D(0), depositsOut = new D(0), corrections = new D(0);

  for (const r of rows) {
    if (r.type === "OPENING_BALANCE") {
      opening[r.method] = opening[r.method].plus(r.amount);
      continue;
    }
    if (r.amount.gt(0)) inBy[r.method] = inBy[r.method].plus(r.amount);
    else outBy[r.method] = outBy[r.method].plus(r.amount.neg());
    if (r.type === "COLLECTION") collections[r.method] = collections[r.method].plus(r.amount);
    if (r.method !== "CASH") continue;
    switch (r.type) {
      case "SALE_PAYMENT": salesIn = salesIn.plus(r.amount); break;
      case "COLLECTION": collectionsIn = collectionsIn.plus(r.amount); break;
      case "REFUND": refundsOut = refundsOut.plus(r.amount.neg()); break;
      case "EXPENSE": case "EXPENSE_REVERSAL": expensesOut = expensesOut.minus(r.amount); break;
      case "WITHDRAWAL": withdrawals = withdrawals.plus(r.amount.neg()); break;
      case "DEPOSIT_OUT": depositsOut = depositsOut.plus(r.amount.neg()); break;
      default: corrections = corrections.plus(r.amount); // ADJUSTMENT (DEPOSIT_IN / CLOSING_DIFFERENCE never appear on open cash rows)
    }
  }

  const expectedCash = opening.CASH.plus(inBy.CASH).minus(outBy.CASH);

  // Expense breakdown from the same rows
  const expenseRowIds = rows.filter((r) => r.type === "EXPENSE" || r.type === "EXPENSE_REVERSAL").map((r) => r.id);
  const byCategory = expenseRowIds.length
    ? await tx.$queryRaw<{ name: string; v: Dec | null }[]>`
        SELECT c."name", SUM(-t."amount") AS v
          FROM "CashTransaction" t JOIN "Expense" e ON e."id" = t."referenceId" JOIN "ExpenseCategory" c ON c."id" = e."categoryId"
         WHERE t."id" IN (${Prisma.join(expenseRowIds)}) AND t."referenceType" = 'Expense'
         GROUP BY c."name" ORDER BY v DESC`
    : [];
  const expenseTotal = byCategory.reduce((s, c) => s.plus(c.v ?? 0), new D(0));
  const st = await salesStats(tx, locationId, day);

  const collectionsTotal = collections.CASH.plus(collections.MOBILE_MONEY).plus(collections.BANK);
  const summary: ClosingSummary = {
    businessDate: day,
    sales: { count: st.count, total: st.total.toString(), paidByMethod: strBy(st.paid), creditGiven: st.credit.toString(), returnsCount: st.returnsCount, returnsValue: st.returnsValue.toString() },
    collections: { total: collectionsTotal.toString(), byMethod: strBy(collections) },
    expenses: { total: expenseTotal.toString(), byCategory: byCategory.map((c) => ({ name: c.name, amount: new D(c.v ?? 0).toString() })) },
    cash: {
      opening: opening.CASH.toString(), salesIn: salesIn.toString(), collectionsIn: collectionsIn.toString(), refundsOut: refundsOut.toString(), expensesOut: expensesOut.toString(),
      withdrawals: withdrawals.toString(), depositsOut: depositsOut.toString(), corrections: corrections.toString(), expected: expectedCash.toString(),
    },
    accounts: METHODS.map((method) => ({ method, opening: opening[method].toString(), in: inBy[method].toString(), out: outBy[method].toString(), balance: opening[method].plus(inBy[method]).minus(outBy[method]).toString() })),
    entries: rows.length,
  };
  return { summary, expectedCash, openingCash: opening.CASH };
}

// ───────────── Preview (what the attendant sees before counting) ─────────────

export async function getClosingPreview(tx: Pick<Tx, "$queryRaw" | "dailyClosing">, locationId: string, day = businessDay()) {
  const [rows, stamped, existing, last] = await Promise.all([
    loadOpenRows(tx, locationId, day),
    stampedBalances(tx, locationId),
    tx.dailyClosing.findUnique({ where: { locationId_businessDate: { locationId, businessDate: dayToDate(day) } }, select: { id: true, closingNo: true } }),
    tx.dailyClosing.findFirst({ where: { locationId }, orderBy: { businessDate: "desc" }, select: { businessDate: true } }),
  ]);
  const { summary, expectedCash } = await summarize(tx, rows, stamped, locationId, day);
  return { day, summary, expectedCash, closed: existing, lastClosedDay: last ? dateToDay(last.businessDate) : null };
}

/** Days before `day` that still have cash entries no closing has taken. */
export async function unclosedDays(tx: Pick<Tx, "$queryRaw">, locationId: string, before = businessDay()) {
  const rows = await tx.$queryRaw<{ d: Date }[]>`
    SELECT DISTINCT t."businessDate" AS d FROM "CashTransaction" t JOIN "CashAccount" a ON a."id" = t."accountId"
     WHERE a."locationId" = ${locationId} AND t."closingId" IS NULL AND t."businessDate" < ${before}::date AND t."type" <> 'OPENING_BALANCE'
     ORDER BY 1`;
  return rows.map((r) => dateToDay(new Date(r.d)));
}

// ───────────── Submit ─────────────

export type SubmitClosingInput = {
  user: { id: string };
  locationId: string;
  day: string;
  countedCash: string;
  notes: string | null;
  deposit: { amount: string; bankReference: string; notes: string | null; slipId: string | null } | null;
  submissionKey: string;
  currencyDecimals: number;
  tolerance: Dec;
};

export async function submitClosing(tx: Tx, input: SubmitClosingInput) {
  const fe: Record<string, string> = {};
  const today = businessDay();
  const day = input.day || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) throw new CashError("Choose a valid day to close.");
  if (day > today) throw new CashError("A day that has not happened yet cannot be closed.");
  const counted = parseMoney(input.countedCash, input.currencyDecimals);
  if (!counted || counted.lt(0)) fe.countedCash = "Enter the cash you counted (type 0 if the till is empty).";
  let depositAmount: Dec | null = null;
  if (input.deposit && input.deposit.amount.trim() !== "") {
    depositAmount = parseMoney(input.deposit.amount, input.currencyDecimals);
    if (!depositAmount || depositAmount.lte(0)) fe.depositAmount = "Enter an amount above zero, or leave it empty.";
    else if (input.deposit.bankReference.trim().length < 2) fe.bankReference = "Enter the bank's reference number from the deposit slip.";
    else if (counted && depositAmount.gt(counted)) fe.depositAmount = "You cannot deposit more than the cash you counted.";
  }
  if (Object.keys(fe).length || !counted) throw new CashError("Please fix the highlighted fields.", fe);

  // Serialise with every other closing / deposit / withdrawal / expense on this location's cash
  const cash = await getAccount(tx, input.locationId, "CASH");
  await lockAccount(tx, cash.id);

  const clash = await tx.dailyClosing.findFirst({ where: { locationId: input.locationId, businessDate: { gte: dayToDate(day) } }, select: { businessDate: true } });
  if (clash) throw new CashError(dateToDay(clash.businessDate) === day ? "This day has already been closed." : "A later day has already been closed, so this day cannot be closed any more.");

  const rows = await loadOpenRows(tx, input.locationId, day);
  const stamped = await stampedBalances(tx, input.locationId);
  const { summary, expectedCash, openingCash } = await summarize(tx, rows, stamped, input.locationId, day);
  const difference = counted.minus(expectedCash);
  const status = difference.abs().gt(input.tolerance) ? "NEEDS_REVIEW" : "SUBMITTED";

  const closingNo = await nextDocumentNo(tx, "CLS");
  const closing = await tx.dailyClosing.create({
    data: {
      closingNo,
      locationId: input.locationId,
      businessDate: dayToDate(day),
      openingCash,
      expectedCash,
      countedCash: counted,
      difference,
      depositedNow: depositAmount ?? new D(0),
      cashCarried: counted.minus(depositAmount ?? 0),
      summary: summary as unknown as Prisma.InputJsonValue,
      notes: input.notes?.trim() || null,
      status,
      submittedById: input.user.id,
      submissionKey: input.submissionKey,
    },
  });

  // Take exactly the rows we read - each can belong to only one closing
  if (rows.length) {
    const taken = await tx.cashTransaction.updateMany({ where: { id: { in: rows.map((r) => r.id) }, closingId: null }, data: { closingId: closing.id } });
    if (taken.count !== rows.length) throw new CashError("Some cash entries were already part of another closing. Reload the page and try again.");
  }
  // The ledger now says exactly what was counted
  if (!difference.isZero()) {
    await postCash(tx, {
      locationId: input.locationId, method: "CASH", type: "CLOSING_DIFFERENCE", amount: difference, referenceType: "DailyClosing", referenceId: closing.id, referenceNo: closingNo,
      description: difference.lt(0) ? "Cash shortage found when counting" : "Cash surplus found when counting", userId: input.user.id, closingId: closing.id,
    });
  }
  let depositNo: string | null = null;
  if (depositAmount && input.deposit) {
    const dep = await postDeposit(tx, {
      user: input.user, locationId: input.locationId, amount: depositAmount.toString(), bankReference: input.deposit.bankReference, notes: input.deposit.notes, slipId: input.deposit.slipId,
      submissionKey: `${input.submissionKey}:deposit`, currencyDecimals: input.currencyDecimals, closingId: closing.id,
    });
    depositNo = dep.depositNo;
  }
  return { closing, difference, status, depositNo, summary };
}

// ───────────── Owner review ─────────────

export async function reviewClosing(tx: Tx, input: { closingId: string; reviewer: { id: string }; note: string }) {
  const note = input.note.trim();
  await tx.$queryRaw`SELECT "id" FROM "DailyClosing" WHERE "id" = ${input.closingId} FOR UPDATE`;
  const c = await tx.dailyClosing.findUnique({ where: { id: input.closingId } });
  if (!c) throw new CashError("This closing no longer exists.");
  if (c.status === "REVIEWED") throw new CashError("This closing was already reviewed.");
  if (c.status === "NEEDS_REVIEW" && note.length < 3) throw new CashError("Write what you found about the difference before signing it off.", { note: "A note is required for a closing with a difference." });
  const updated = await tx.dailyClosing.update({ where: { id: c.id }, data: { status: "REVIEWED", reviewedById: input.reviewer.id, reviewedAt: new Date(), reviewNote: note || null } });
  return { closing: updated, submittedById: c.submittedById };
}
