"use client";

import { useActionState, useId, useState } from "react";
import { Camera } from "lucide-react";
import { Alert } from "@/components/ui";
import AccountSelect, { type FormAccount } from "@/components/cash/AccountSelect";
import { Field, SubmitButton, inputClass } from "@/components/FormBits";
import type { ActionState } from "@/lib/action";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;
const initial: ActionState = {};

export function DepositForm({ action, submissionKey, cashBalance, bankAccounts }: { action: Action; submissionKey: string; cashBalance: string; bankAccounts: FormAccount[] }) {
  const [state, formAction] = useActionState(action, initial);
  const uid = useId();
  const id = (n: string) => `${uid}-${n}`;
  const fe = state.fieldErrors ?? {};
  const v = state.values ?? {};
  return (
    <form action={formAction} noValidate className="space-y-4">
      <input type="hidden" name="submissionKey" value={submissionKey} />
      {state.error && <Alert>{state.error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount deposited" name="depositAmount" id={id("amt")} error={fe.depositAmount} hint={`Cash on hand now: ${cashBalance}`} required>
          <input id={id("amt")} name="depositAmount" inputMode="numeric" autoComplete="off" defaultValue={v.depositAmount ?? ""} placeholder="0" className={`${inputClass(fe.depositAmount)} text-lg font-semibold`} />
        </Field>
        <Field label="Into which bank account" name="bankAccountId" id={id("bank")} error={fe.bankAccountId}>
          <AccountSelect accounts={bankAccounts} id={id("bank")} name="bankAccountId" defaultValue={v.bankAccountId} error={fe.bankAccountId} />
        </Field>
        <Field label="Bank reference" name="bankReference" id={id("ref")} error={fe.bankReference} hint="From the deposit slip." required>
          <input id={id("ref")} name="bankReference" autoComplete="off" defaultValue={v.bankReference ?? ""} className={inputClass(fe.bankReference)} />
        </Field>
        <Field label="Slip photo (optional)" name="slip" id={id("slip")} error={fe.slip}>
          <label htmlFor={id("slip")} className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-sm text-slate-600 hover:border-navy-300 hover:bg-navy-50">
            <Camera size={16} />
            <input id={id("slip")} type="file" name="slip" accept="image/*" className="w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium" />
          </label>
        </Field>
        <Field label="Notes (optional)" name="notes" id={id("notes")}>
          <input id={id("notes")} name="notes" autoComplete="off" defaultValue={v.notes ?? ""} className="input" />
        </Field>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">The money moves from cash on hand to the bank account. It is not an expense and not income.</p>
        <SubmitButton pendingLabel="Saving…">Record deposit</SubmitButton>
      </div>
    </form>
  );
}

const KINDS = [
  { value: "OPENING", label: "Opening balance (money already there at the start)" },
  { value: "WITHDRAWAL", label: "Owner takes money out" },
  { value: "CORRECTION_IN", label: "Correction: add money" },
  { value: "CORRECTION_OUT", label: "Correction: remove money" },
];

export function ManualCashForm({ action, submissionKey, openingDone, accounts }: { action: Action; submissionKey: string; openingDone: Record<string, boolean>; accounts: { id: string; name: string; accountNumber: string | null; method: string }[] }) {
  const [state, formAction] = useActionState(action, initial);
  const uid = useId();
  const id = (n: string) => `${uid}-${n}`;
  const fe = state.fieldErrors ?? {};
  const v = state.values ?? {};
  const [kind, setKind] = useState(v.kind ?? "WITHDRAWAL");
  const [accountId, setAccountId] = useState(v.accountId ?? accounts.find((a) => a.method === "CASH")?.id ?? accounts[0]?.id ?? "");
  const blocked = kind === "OPENING" && openingDone[accountId];
  return (
    <form action={formAction} noValidate className="space-y-4">
      <input type="hidden" name="submissionKey" value={submissionKey} />
      {state.error && <Alert>{state.error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="What happened?" name="kind" id={id("kind")} error={fe.kind} className="sm:col-span-2">
          <select id={id("kind")} name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className={inputClass(fe.kind)}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Account" name="accountId" id={id("account")} error={fe.accountId}>
          <select id={id("account")} name="accountId" value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputClass(fe.accountId)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.accountNumber ? ` · ${a.accountNumber}` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount" name="amount" id={id("amount")} error={fe.amount} required>
          <input id={id("amount")} name="amount" inputMode="numeric" autoComplete="off" defaultValue={v.amount ?? ""} placeholder="0" className={`${inputClass(fe.amount)} font-semibold`} />
        </Field>
        <Field label={kind === "OPENING" ? "Note (optional)" : "Reason"} name="reason" id={id("reason")} error={fe.reason} required={kind !== "OPENING"} className="sm:col-span-2">
          <input id={id("reason")} name="reason" autoComplete="off" defaultValue={v.reason ?? ""} className={inputClass(fe.reason)} placeholder={kind === "WITHDRAWAL" ? "e.g. Paid the supplier for the next shipment" : kind === "OPENING" ? "e.g. Counted on the first day" : "Say what you found"} />
        </Field>
      </div>
      {blocked && <Alert kind="info">The opening balance of this account was already recorded. Use a correction to change the balance.</Alert>}
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Saving…">{kind === "OPENING" ? "Set opening balance" : kind === "WITHDRAWAL" ? "Record withdrawal" : "Record correction"}</SubmitButton>
      </div>
    </form>
  );
}

export function ReviewClosingForm({ closingId, action, needsNote }: { closingId: string; action: Action; needsNote: boolean }) {
  const [state, formAction] = useActionState(action, initial);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="space-y-2.5">
      <input type="hidden" name="closingId" value={closingId} />
      <input name="note" className={`input ${fe.note ? "input-error" : ""}`} placeholder={needsNote ? "What did you find about the difference? (required)" : "Note (optional)"} aria-label="Review note" />
      {fe.note && <p className="field-error">{fe.note}</p>}
      {state.error && !fe.note && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.message}</Alert>}
      <SubmitButton pendingLabel="Saving…">Sign off this closing</SubmitButton>
    </form>
  );
}
