// Moving money between the shop's own accounts (cash to mobile money, one bank to another, mobile money to the bank...).
// It is not income and not spending: two ledger rows with the same source (TRANSFER_OUT on one account, TRANSFER_IN on the
// other) are written in one transaction, so the total of all money never changes. The source account must hold the amount.
import type { Tx } from "@/lib/inventory/engine";
import { parseMoney } from "@/lib/money";
import { CashError, assertCanSpend, lockAccount, postCash } from "./ledger";

export type TransferInput = {
  user: { id: string };
  fromId: string;
  toId: string;
  amount: string;
  reason: string;
  /** one per submitted form: pressing the button twice moves the money once */
  submissionKey: string;
  currencyDecimals: number;
};

export async function transferMoney(tx: Tx, input: TransferInput) {
  const fe: Record<string, string> = {};
  const amount = parseMoney(input.amount, input.currencyDecimals);
  if (!amount || amount.lte(0)) fe.amount = input.currencyDecimals === 0 ? "Enter a whole amount above zero." : "Enter an amount above zero.";
  if (!input.fromId) fe.fromId = "Choose where the money comes from.";
  if (!input.toId) fe.toId = "Choose where it goes.";
  else if (input.fromId === input.toId) fe.toId = "Choose a different account to move it to.";
  const reason = input.reason.trim();
  if (reason.length < 3) fe.reason = "Say why (a few words).";
  if (reason.length > 200) fe.reason = "Keep the reason under 200 characters.";
  if (Object.keys(fe).length || !amount) throw new CashError("Please fix the highlighted fields.", fe);

  // both accounts are locked in a fixed order, so two moves at the same moment cannot wait for each other
  for (const id of [input.fromId, input.toId].sort()) await lockAccount(tx, id);
  const [from, to] = await Promise.all([tx.cashAccount.findUnique({ where: { id: input.fromId } }), tx.cashAccount.findUnique({ where: { id: input.toId } })]);
  if (!from || !to) throw new CashError("One of the accounts no longer exists.");
  if (from.locationId !== to.locationId) throw new CashError("Both accounts must belong to the same shop.");
  if (from.status !== "ACTIVE" || to.status !== "ACTIVE") throw new CashError("Both accounts must be open.");
  await assertCanSpend(tx, from.id, from.method, amount, "amount");

  const common = { locationId: from.locationId, referenceType: "Transfer", referenceId: input.submissionKey, userId: input.user.id };
  const out = await postCash(tx, { ...common, method: from.method, accountId: from.id, type: "TRANSFER_OUT", amount: amount.neg(), description: `Moved to ${to.name}: ${reason}` });
  const inn = await postCash(tx, { ...common, method: to.method, accountId: to.id, type: "TRANSFER_IN", amount, description: `Moved from ${from.name}: ${reason}` });
  return { from, to, amount, out, inn, reason };
}
