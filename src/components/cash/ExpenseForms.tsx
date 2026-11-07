"use client";

import { useActionState, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { Camera } from "lucide-react";
import { Alert } from "@/components/ui";
import { type FormAccount } from "@/components/cash/AccountSelect";
import { Field, SubmitButton, inputClass } from "@/components/FormBits";
import type { ActionState } from "@/lib/action";
import { cn } from "@/lib/utils";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;
const initial: ActionState = {};

/**
 * Quick expense form for the shop person (he records every shop expense): tap what it was for, type the amount, tap where the
 * money came from, save. Date, receipt photo and a note are tucked away; "Details" is optional (the category name is used when empty).
 */
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
  const [categoryId, setCategoryId] = useState(v.categoryId ?? "");
  const [accountId, setAccountId] = useState(v.accountId ?? accounts.find((a) => a.method === "CASH")?.id ?? accounts[0]?.id ?? "");
  const [amount, setAmount] = useState((v.amount ?? "").replace(/\D/g, ""));
  const KIND: Record<string, string> = { CASH: "Cash", MOBILE_MONEY: "Mobile money", BANK: "Bank" };
  const chip = (on: boolean) => cn("rounded-lg border px-3 py-2.5 text-left text-sm font-medium leading-tight transition", on ? "border-navy-600 bg-navy-50 text-navy-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50");
  return (
    <form action={formAction} noValidate className="space-y-5">
      <input type="hidden" name="submissionKey" value={submissionKey} />
      <input type="hidden" name="categoryId" value={categoryId} />
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="amount" value={amount} />
      {state.error && <Alert>{state.error}</Alert>}

      <div>
        <p className="label" id={id("cat")}>
          What was it for?<span className="ml-0.5 text-brand-red">*</span>
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" role="radiogroup" aria-labelledby={id("cat")}>
          {categories.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={c.id === categoryId} onClick={() => setCategoryId(c.id)} className={chip(c.id === categoryId)}>
              {c.name}
            </button>
          ))}
        </div>
        {fe.categoryId && <p className="field-error mt-1.5">{fe.categoryId}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount" name="amountShown" id={id("amount")} error={fe.amount} required>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-500">TSh</span>
            <input id={id("amount")} inputMode="numeric" autoComplete="off" placeholder="0" value={amount ? Number(amount).toLocaleString("en-US") : ""} onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 12))} className={`${inputClass(fe.amount)} pl-12 text-2xl font-bold tabular-nums`} />
          </div>
        </Field>
        <Field label="Details (optional)" name="description" id={id("desc")} error={categoryId ? fe.description : undefined}>
          <input id={id("desc")} name="description" autoComplete="off" defaultValue={v.description ?? ""} placeholder="e.g. Taxi to deliver 4 cartons to Mwenge" className={`${inputClass(categoryId ? fe.description : undefined)} h-[3.25rem]`} />
        </Field>
      </div>

      <div>
        <p className="label" id={id("account")}>
          Paid from
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" role="radiogroup" aria-labelledby={id("account")}>
          {accounts.map((a) => (
            <button key={a.id} type="button" role="radio" aria-checked={a.id === accountId} onClick={() => setAccountId(a.id)} className={chip(a.id === accountId)}>
              <span className="block">{a.name}</span>
              <span className="block truncate text-[11px] font-normal text-slate-500">
                {(KIND[a.method] ?? a.method) === a.name ? "" : KIND[a.method] ?? a.method}
                {a.accountNumber ? `${(KIND[a.method] ?? a.method) === a.name ? "" : " · "}${a.accountNumber}` : ""}
              </span>
            </button>
          ))}
        </div>
        {(fe.accountId ?? fe.method) && <p className="field-error mt-1.5">{fe.accountId ?? fe.method}</p>}
      </div>

      <details className="group rounded-lg border border-line px-3 py-2.5" open={Boolean(fe.expenseDate || fe.receipt)}>
        <summary className="cursor-pointer list-none text-sm font-medium text-slate-600 group-open:mb-3">Add a receipt photo, a note, or change the date</summary>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date" name="expenseDate" id={id("date")} error={fe.expenseDate}>
            <input id={id("date")} type="date" name="expenseDate" defaultValue={v.expenseDate ?? today} max={today} className={inputClass(fe.expenseDate)} />
          </Field>
          <Field label="Note (optional)" name="notes" id={id("notes")}>
            <input id={id("notes")} name="notes" autoComplete="off" defaultValue={v.notes ?? ""} className="input" />
          </Field>
          <Field label="Receipt photo (optional)" name="receipt" id={id("receipt")} error={fe.receipt} hint="A picture of the receipt helps the owner check it." className="sm:col-span-2">
            <label htmlFor={id("receipt")} className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-sm text-slate-600 hover:border-navy-300 hover:bg-navy-50">
              <Camera size={16} />
              <input id={id("receipt")} type="file" name="receipt" accept="image/*" className="w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium" />
            </label>
          </Field>
        </div>
      </details>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">{limitText}</p>
        <SubmitButton pendingLabel="Saving…" className="btn-primary w-full sm:w-auto sm:min-w-48">
          Save expense
        </SubmitButton>
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
