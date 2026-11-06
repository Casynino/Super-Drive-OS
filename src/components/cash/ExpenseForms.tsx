"use client";

import { useActionState, useId } from "react";
import { useFormStatus } from "react-dom";
import { Camera } from "lucide-react";
import { Alert } from "@/components/ui";
import AccountSelect, { type FormAccount } from "@/components/cash/AccountSelect";
import { Field, SubmitButton, inputClass } from "@/components/FormBits";
import type { ActionState } from "@/lib/action";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;
const initial: ActionState = {};

export function ExpenseForm({
  action,
  categories,
  today,
  submissionKey,
  limitText,
  accounts,
}: {
  action: Action;
  accounts: FormAccount[];
  categories: { id: string; name: string }[];
  today: string;
  submissionKey: string;
  /** e.g. "Up to TSh 20,000 is recorded straight away." */
  limitText: string;
}) {
  const [state, formAction] = useActionState(action, initial);
  const uid = useId();
  const fe = state.fieldErrors ?? {};
  const v = state.values ?? {};
  const id = (n: string) => `${uid}-${n}`;
  return (
    <form action={formAction} noValidate className="space-y-4">
      <input type="hidden" name="submissionKey" value={submissionKey} />
      {state.error && <Alert>{state.error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="What was it for?" name="categoryId" id={id("cat")} error={fe.categoryId} required>
          <select id={id("cat")} name="categoryId" defaultValue={v.categoryId ?? ""} className={inputClass(fe.categoryId)}>
            <option value="" disabled>
              Choose a category
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount" name="amount" id={id("amount")} error={fe.amount} required>
          <input id={id("amount")} name="amount" inputMode="numeric" autoComplete="off" defaultValue={v.amount ?? ""} placeholder="0" className={`${inputClass(fe.amount)} text-lg font-semibold`} />
        </Field>
        <Field label="Description" name="description" id={id("desc")} error={fe.description} required className="sm:col-span-2">
          <input id={id("desc")} name="description" autoComplete="off" defaultValue={v.description ?? ""} placeholder="e.g. Taxi to deliver 4 cartons to Mwenge" className={inputClass(fe.description)} />
        </Field>
        <Field label="Paid from" name="accountId" id={id("account")} error={fe.accountId ?? fe.method}>
          <AccountSelect accounts={accounts} id={id("account")} defaultValue={v.accountId ?? accounts.find((a) => a.method === "CASH")?.id} error={fe.accountId ?? fe.method} />
        </Field>
        <Field label="Date" name="expenseDate" id={id("date")} error={fe.expenseDate}>
          <input id={id("date")} type="date" name="expenseDate" defaultValue={v.expenseDate ?? today} max={today} className={inputClass(fe.expenseDate)} />
        </Field>
        <Field label="Receipt photo (optional)" name="receipt" id={id("receipt")} error={fe.receipt} hint="A picture of the receipt helps the owner check it." className="sm:col-span-2">
          <label htmlFor={id("receipt")} className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-sm text-slate-600 hover:border-navy-300 hover:bg-navy-50">
            <Camera size={16} />
            <input id={id("receipt")} type="file" name="receipt" accept="image/*" className="w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium" />
          </label>
        </Field>
        <Field label="Notes (optional)" name="notes" id={id("notes")} className="sm:col-span-2">
          <input id={id("notes")} name="notes" autoComplete="off" defaultValue={v.notes ?? ""} className="input" />
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">{limitText}</p>
        <SubmitButton pendingLabel="Saving…">Record expense</SubmitButton>
      </div>
    </form>
  );
}

function DecisionButtons() {
  const { pending } = useFormStatus();
  return (
    <div className="flex flex-wrap gap-2">
      <button type="submit" name="decision" value="approve" className="btn-primary" disabled={pending}>
        {pending ? "Working…" : "Approve"}
      </button>
      <button type="submit" name="decision" value="reject" className="btn-danger" disabled={pending}>
        Reject
      </button>
    </div>
  );
}

export function ExpenseDecisionForm({ expenseId, action }: { expenseId: string; action: Action }) {
  const [state, formAction] = useActionState(action, initial);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="space-y-2.5">
      <input type="hidden" name="expenseId" value={expenseId} />
      <input name="note" className={`input ${fe.note ? "input-error" : ""}`} placeholder="Note (required to reject)" aria-label="Decision note" />
      {fe.note && <p className="field-error">{fe.note}</p>}
      {state.error && !fe.note && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.message}</Alert>}
      <DecisionButtons />
    </form>
  );
}

export function ReverseExpenseForm({ expenseId, action }: { expenseId: string; action: Action }) {
  const [state, formAction] = useActionState(action, initial);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="space-y-2.5">
      <input type="hidden" name="expenseId" value={expenseId} />
      <input name="reason" className={`input ${fe.reason ? "input-error" : ""}`} placeholder="Why is this being reversed?" aria-label="Reason" />
      {fe.reason && <p className="field-error">{fe.reason}</p>}
      {state.error && !fe.reason && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.message}</Alert>}
      <SubmitButton className="btn-danger" pendingLabel="Reversing…">
        Reverse expense
      </SubmitButton>
    </form>
  );
}
