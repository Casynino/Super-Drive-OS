// Bank deposits and the owner's manual cash entries.
// A deposit is a TRANSFER: cash leaves the till and the same amount arrives in the bank account. It is never income
// and never an expense. Partial deposits are normal: whatever is not deposited simply stays as cash on hand.
// Lock order: document counter → cash account row.
import { Prisma, type PaymentMethod } from "@/generated/prisma/client";
import { nextDocumentNo, type Tx } from "@/lib/inventory/engine";
import { parseMoney } from "@/lib/money";
import { CashError, assertCanSpend, businessDay, dayToDate, getAccount, lockAccount, postCash, resolveAccount } from "./ledger";

const D = Prisma.Decimal;

export type DepositInput = {
  user: { id: string };
  locationId: string;
  amount: string;
  bankReference: string;
  notes: string | null;
  slipId: string | null;
  /** the bank account the money is paid into; required when there are several open bank accounts */
  bankAccountId?: string | null;
  submissionKey: string;
  currencyDecimals: number;
  /** set when the deposit is made as part of a daily closing */
  closingId?: string | null;
};

export async function postDeposit(tx: Tx, input: DepositInput) {
  const fe: Record<string, string> = {};
  const amount = parseMoney(input.amount, input.currencyDecimals);
  if (!amount || amount.lte(0)) fe.depositAmount = input.currencyDecimals === 0 ? "Enter a whole amount above zero." : "Enter an amount above zero.";
  const ref = input.bankReference.trim();
  if (ref.length < 2) fe.bankReference = "Enter the bank's reference number from the deposit slip.";
  if (ref.length > 80) fe.bankReference = "Keep the reference under 80 characters.";
  if (Object.keys(fe).length || !amount) throw new CashError("Please fix the highlighted fields.", fe);

  // The account is locked BEFORE the number counter (daily closings take them in this order too), so they cannot deadlock.
  const cash = await getAccount(tx, input.locationId, "CASH");
  await lockAccount(tx, cash.id);
  const bank = await resolveAccount(tx, { locationId: input.locationId, method: "BANK", accountId: input.bankAccountId, field: "bankAccountId" });
  const depositNo = await nextDocumentNo(tx, "DEP");
  // Insert first: a double-submitted form fails here before any money moves.
  const deposit = await tx.bankDeposit.create({
    data: {
      depositNo,
      locationId: input.locationId,
      amount,
      bankReference: ref,
      notes: input.notes?.trim() || null,
      slipId: input.slipId,
      businessDate: dayToDate(businessDay()),
      closingId: input.closingId ?? null,
      createdById: input.user.id,
      submissionKey: input.submissionKey,
    },
  });
  await assertCanSpend(tx, cash.id, "CASH", amount, "depositAmount");
  const common = { referenceType: "BankDeposit", referenceId: deposit.id, referenceNo: depositNo, userId: input.user.id, closingId: input.closingId ?? null };
  await postCash(tx, { ...common, locationId: input.locationId, method: "CASH", type: "DEPOSIT_OUT", amount: amount.neg(), description: `Bank deposit ${ref}` });
  await postCash(tx, { ...common, locationId: input.locationId, method: "BANK", accountId: bank.id, type: "DEPOSIT_IN", amount, description: `Bank deposit ${ref}` });
  return deposit;
}

// ───────────── Owner's manual entries ─────────────

export type ManualKind = "OPENING" | "WITHDRAWAL" | "CORRECTION_IN" | "CORRECTION_OUT";

export type ManualCashInput = {
  user: { id: string };
  locationId: string;
  method: PaymentMethod;
  /** the exact account; required when the method has several open accounts */
  accountId?: string | null;
  kind: ManualKind;
  amount: string;
  reason: string;
  submissionKey: string;
  currencyDecimals: number;
};

/** Opening balance (once per account), withdrawals by the owner, and authorised corrections. Always with a reason, never silent. */
export async function postManualCash(tx: Tx, input: ManualCashInput) {
  const fe: Record<string, string> = {};
  const amount = parseMoney(input.amount, input.currencyDecimals);
  if (!amount || amount.lte(0)) fe.amount = input.currencyDecimals === 0 ? "Enter a whole amount above zero." : "Enter an amount above zero.";
  const reason = input.reason.trim();
  if (input.kind !== "OPENING" && reason.length < 5) fe.reason = "Say why (at least a few words).";
  if (reason.length > 300) fe.reason = "Keep the reason under 300 characters.";
  if (Object.keys(fe).length || !amount) throw new CashError("Please fix the highlighted fields.", fe);

  const account = await resolveAccount(tx, { locationId: input.locationId, method: input.method, accountId: input.accountId, field: "accountId" });
  const label = { OPENING: "Opening balance", WITHDRAWAL: "Withdrawal", CORRECTION_IN: "Correction (added)", CORRECTION_OUT: "Correction (removed)" }[input.kind];
  const description = reason ? `${label}: ${reason}` : label;

  if (input.kind === "OPENING") {
    const exists = await tx.cashTransaction.findFirst({ where: { accountId: account.id, type: "OPENING_BALANCE" }, select: { id: true } });
    if (exists) throw new CashError("The opening balance of this account was already recorded. Use a correction to change the balance.", { amount: "Already recorded." });
    return postCash(tx, { locationId: input.locationId, method: input.method, accountId: account.id, type: "OPENING_BALANCE", amount, referenceType: "Opening", referenceId: account.id, description, userId: input.user.id });
  }
  const outgoing = input.kind !== "CORRECTION_IN";
  if (outgoing) await assertCanSpend(tx, account.id, input.method, amount, "amount");
  return postCash(tx, {
    locationId: input.locationId,
    method: input.method,
    accountId: account.id,
    type: input.kind === "WITHDRAWAL" ? "WITHDRAWAL" : "ADJUSTMENT",
    amount: outgoing ? amount.neg() : amount,
    referenceType: "Manual",
    referenceId: input.submissionKey,
    description,
    userId: input.user.id,
  });
}

export const zero = new D(0);
