// Expenses. Money only leaves an account when an expense is APPROVED:
//   within the limit (or recorded by someone who may approve)  → APPROVED at once, ledger row written
//   above the limit                                              → PENDING, nothing moves until the owner approves
// An approved expense is never edited or deleted. It can be REVERSED (money put back) with a reason.
// Lock order: document counter → expense row → cash account row.
import { Prisma, type PaymentMethod } from "@/generated/prisma/client";
import { nextDocumentNo, type Dec, type Tx } from "@/lib/inventory/engine";
import { parseMoney } from "@/lib/money";
import { CashError, assertCanSpend, businessDay, dayToDate, defaultLocationId, postCash, resolveAccount } from "./ledger";

const D = Prisma.Decimal;

export type RecordExpenseInput = {
  user: { id: string };
  categoryId: string;
  description: string;
  amount: string;
  method: PaymentMethod;
  /** the exact account it is paid from (CRDB, M-PESA, ...); required when the method has several open accounts */
  accountId?: string | null;
  /** "YYYY-MM-DD"; blank = today */
  expenseDate: string;
  notes: string | null;
  receiptId: string | null;
  submissionKey: string;
  currencyDecimals: number;
  /** the general limit from settings */
  approvalLimit: Dec;
  /** the person may approve expenses, so their own is approved at once */
  canApprove: boolean;
  /** blank = the default location */
  locationId?: string;
};

export async function recordExpense(tx: Tx, input: RecordExpenseInput) {
  const fe: Record<string, string> = {};
  const amount = parseMoney(input.amount, input.currencyDecimals);
  if (!amount || amount.lte(0)) fe.amount = input.currencyDecimals === 0 ? "Enter a whole amount above zero." : "Enter an amount above zero.";
  const description = input.description.trim();
  if (description.length < 3) fe.description = "Say what the money was spent on.";
  if (description.length > 200) fe.description = "Keep it under 200 characters.";
  const today = businessDay();
  const day = input.expenseDate || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) fe.expenseDate = "Choose a valid date.";
  else if (day > today) fe.expenseDate = "The date cannot be in the future.";
  else if (Date.parse(today) - Date.parse(day) > 31 * 86_400_000) fe.expenseDate = "Only the last 31 days can be recorded.";
  const category = await tx.expenseCategory.findUnique({ where: { id: input.categoryId } });
  if (!category || category.status !== "ACTIVE") fe.categoryId = "Choose a category.";
  if (Object.keys(fe).length || !amount || !category) throw new CashError("Please fix the highlighted fields.", fe);

  const limit = category.approvalLimit ?? input.approvalLimit;
  const approvedNow = input.canApprove || amount.lte(limit);
  const locationId = input.locationId ?? (await defaultLocationId(tx));
  const account = await resolveAccount(tx, { locationId, method: input.method, accountId: input.accountId, field: "accountId" });
  const expenseNo = await nextDocumentNo(tx, "EXP");

  // Insert first: a double-submitted form fails here (unique submissionKey), before any money moves.
  const expense = await tx.expense.create({
    data: {
      expenseNo,
      categoryId: category.id,
      description,
      amount,
      method: input.method,
      cashAccountId: account.id,
      expenseDate: dayToDate(day),
      notes: input.notes?.trim() || null,
      receiptId: input.receiptId,
      status: approvedNow ? "APPROVED" : "PENDING",
      locationId,
      requestedById: input.user.id,
      decidedById: approvedNow && input.canApprove ? input.user.id : null,
      decidedAt: approvedNow ? new Date() : null,
      decisionNote: approvedNow ? (input.canApprove ? null : "Within the approval limit") : null,
      submissionKey: input.submissionKey,
    },
  });
  if (approvedNow) await payOut(tx, expense, input.user.id);
  return { expense, approvedNow, categoryName: category.name };
}

async function payOut(tx: Tx, e: { id: string; expenseNo: string; amount: Dec; method: PaymentMethod; cashAccountId: string | null; locationId: string; description: string }, userId: string) {
  // the account chosen when the expense was recorded (older expenses: the default account of the method)
  const account = await resolveAccount(tx, { locationId: e.locationId, method: e.method, accountId: e.cashAccountId, lenient: true });
  await assertCanSpend(tx, account.id, e.method, e.amount, "method");
  await postCash(tx, { locationId: e.locationId, method: e.method, accountId: account.id, type: "EXPENSE", amount: e.amount.neg(), referenceType: "Expense", referenceId: e.id, referenceNo: e.expenseNo, description: e.description, userId });
}

async function lockExpense(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "Expense" WHERE "id" = ${id} FOR UPDATE`;
  const e = await tx.expense.findUnique({ where: { id }, include: { category: { select: { name: true } } } });
  if (!e) throw new CashError("This expense no longer exists.");
  return e;
}

/** The owner (or a manager) approves or rejects an expense that was above the limit. */
export async function decideExpense(tx: Tx, input: { expenseId: string; approver: { id: string }; approve: boolean; note: string }) {
  const note = input.note.trim();
  if (!input.approve && note.length < 3) throw new CashError("Give a short reason for rejecting.", { note: "Say why it is rejected." });
  const e = await lockExpense(tx, input.expenseId);
  if (e.status !== "PENDING") throw new CashError(`This expense was already ${e.status.toLowerCase()}.`);
  if (input.approve) await payOut(tx, e, input.approver.id);
  const updated = await tx.expense.update({
    where: { id: e.id },
    data: { status: input.approve ? "APPROVED" : "REJECTED", decidedById: input.approver.id, decidedAt: new Date(), decisionNote: note || null },
  });
  return { expense: updated, requestedById: e.requestedById, categoryName: e.category.name };
}

/** Puts the money of an approved expense back. The expense stays on record, marked reversed. */
export async function reverseExpense(tx: Tx, input: { expenseId: string; by: { id: string }; reason: string }) {
  const reason = input.reason.trim();
  if (reason.length < 3) throw new CashError("Say why the expense is being reversed.", { reason: "A reason is required." });
  const e = await lockExpense(tx, input.expenseId);
  if (e.status !== "APPROVED") throw new CashError(`Only an approved expense can be reversed (this one is ${e.status.toLowerCase()}).`);
  // the money goes back to the account it left
  const paidFrom = await tx.cashTransaction.findFirst({ where: { referenceType: "Expense", referenceId: e.id, type: "EXPENSE" }, select: { accountId: true } });
  await postCash(tx, {
    locationId: e.locationId,
    method: e.method,
    accountId: paidFrom?.accountId,
    allowClosed: true,
    lenient: true,
    type: "EXPENSE_REVERSAL",
    amount: e.amount,
    referenceType: "Expense",
    referenceId: e.id,
    referenceNo: e.expenseNo,
    description: `Reversed: ${reason}`,
    userId: input.by.id,
  });
  const updated = await tx.expense.update({ where: { id: e.id }, data: { status: "REVERSED", reversedById: input.by.id, reversedAt: new Date(), reversalReason: reason } });
  return { expense: updated, requestedById: e.requestedById };
}
