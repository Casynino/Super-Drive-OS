"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowLeft, Camera, ChevronRight, Plus, X } from "lucide-react";
import { Alert } from "@/components/ui";
import { type FormAccount } from "@/components/cash/AccountSelect";
import { Field, SubmitButton, inputClass } from "@/components/FormBits";
import type { ActionState } from "@/lib/action";
import { cn } from "@/lib/utils";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;
const initial: ActionState = {};

type ExpenseFormProps = {
  action: Action;
  accounts: FormAccount[];
  categories: { id: string; name: string }[];
  today: string;
  submissionKey: string;
  /** e.g. "Up to TSh 20,000 is recorded straight away." */
  limitText: string;
  /** a type that is not on the list can be added ("Something else") */
  canAddType?: boolean;
};

/**
 * "Record expense" button + pop-up for the shop person (he records every shop expense). Two short steps: 1 What (tap the
 * category), 2 How much (amount, where the money came from, save). Details, receipt photo, note and date are optional.
 */
export function RecordExpenseButton(props: ExpenseFormProps) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <>
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
        <Plus size={18} aria-hidden /> Record expense
      </button>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="Record an expense" className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-white shadow-2xl sm:max-w-xl sm:rounded-2xl">
            <ExpenseForm {...props} onClose={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}

function ExpenseForm({ action, categories, today, submissionKey, limitText, accounts, canAddType, onClose }: ExpenseFormProps & { onClose: () => void }) {
  const [state, formAction] = useActionState(action, initial);
  const uid = useId();
  const fe = state.fieldErrors ?? {};
  const v = state.values ?? {};
  const id = (n: string) => `${uid}-${n}`;
  const [categoryId, setCategoryId] = useState(v.categoryId ?? "");
  const [newType, setNewType] = useState(v.newCategoryName ?? ""); // a type that is not on the list yet (owner)
  const [adding, setAdding] = useState(false);
  const [step, setStep] = useState<1 | 2>(v.categoryId || v.newCategoryName ? 2 : 1);
  const [accountId, setAccountId] = useState(v.accountId ?? accounts.find((a) => a.method === "CASH")?.id ?? accounts[0]?.id ?? "");
  const [amount, setAmount] = useState((v.amount ?? "").replace(/\D/g, ""));
  const amountRef = useRef<HTMLInputElement>(null);
  // an error about the account goes away as soon as another account is chosen (it comes back if the server finds a new one)
  const [accountChanged, setAccountChanged] = useState(false);
  useEffect(() => setAccountChanged(false), [state]);
  const accountError = accountChanged ? undefined : (fe.accountId ?? fe.method);
  const category = categories.find((c) => c.id === categoryId);
  const typeName = category?.name ?? (newType.trim() || "");
  const KIND: Record<string, string> = { CASH: "Cash", MOBILE_MONEY: "Mobile money", BANK: "Bank" };
  const kindOf = (a: FormAccount) => ((KIND[a.method] ?? a.method) === a.name ? "" : (KIND[a.method] ?? a.method));
  const goStep2 = () => {
    setStep(2);
    // with a mouse the cursor goes straight to the amount; on a phone the keyboard stays closed until it is tapped
    if (typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches) setTimeout(() => amountRef.current?.focus(), 30);
  };
  const pick = (cid: string) => {
    setCategoryId(cid);
    setNewType("");
    goStep2();
  };
  // a new name that already exists in the list simply picks that one
  const useNewType = () => {
    const name = newType.replace(/\s+/g, " ").trim();
    if (name.length < 2) return;
    const same = categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (same) return pick(same.id);
    setCategoryId("");
    setNewType(name);
    setAdding(false);
    goStep2();
  };
  const chip = (on: boolean) => cn("rounded-xl border px-3.5 py-3 text-left text-sm font-medium leading-tight transition", on ? "border-navy-600 bg-navy-50 text-navy-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50");
  const stepPill = (n: 1 | 2, label: string) => (
    <button type="button" onClick={() => (n === 1 || typeName) && setStep(n)} aria-current={step === n ? "step" : undefined} className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold tracking-wide transition", step === n ? "bg-navy-700 text-white" : "text-slate-500 hover:text-slate-800")}>
      <span>{n}</span> {label}
    </button>
  );
  return (
    <form action={formAction} noValidate className="flex min-h-0 flex-1 flex-col">
      <input type="hidden" name="submissionKey" value={submissionKey} />
      <input type="hidden" name="categoryId" value={categoryId} />
      <input type="hidden" name="newCategoryName" value={categoryId ? "" : newType.trim()} />
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="amount" value={amount} />

      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div className="flex items-center gap-1">
          {stepPill(1, "What")}
          <span className="text-slate-300">—</span>
          {stepPill(2, "How much")}
        </div>
        <button type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900" aria-label="Close">
          <X size={18} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-5">
        {state.error && !(accountChanged && accountError === undefined && (fe.accountId || fe.method)) && (
          <div className="mb-4">
            <Alert>{state.error}</Alert>
          </div>
        )}

        {/* 1 What */}
        <div className={step === 1 ? "" : "hidden"}>
          <h2 className="text-xl font-semibold text-slate-900">What was it for?</h2>
          <p className="mb-4 mt-1 text-sm text-slate-500">Tap one.</p>
          {categories.length === 0 ? (
            <Alert kind="info">The owner has not set up expense categories yet (Settings → Expenses).</Alert>
          ) : (
            <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2" role="radiogroup" aria-label="What was it for?">
              {categories.map((c) => (
                <button key={c.id} type="button" role="radio" aria-checked={c.id === categoryId} onClick={() => pick(c.id)} className={cn(chip(c.id === categoryId), "flex items-center justify-between gap-2 py-3.5 text-base")}>
                  {c.name}
                  <ChevronRight size={16} className="shrink-0 text-slate-400" aria-hidden />
                </button>
              ))}
              {canAddType &&
                (adding ? (
                  <div className="col-span-full flex flex-col gap-2 rounded-xl border border-dashed border-navy-400 p-3 min-[420px]:flex-row min-[420px]:items-center">
                    <input autoFocus value={newType} onChange={(e) => setNewType(e.target.value.slice(0, 60))} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), useNewType())} placeholder="Name the new type, e.g. Car wash" aria-label="Name of the new type of expense" className="input min-w-0 flex-1" />
                    <div className="flex gap-2">
                      <button type="button" onClick={useNewType} disabled={newType.trim().length < 2} className="btn-primary flex-1 min-[420px]:flex-none">
                        Next
                      </button>
                      <button type="button" onClick={() => (setAdding(false), setNewType(""))} className="btn-secondary">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setAdding(true)} className="col-span-full flex items-center gap-2 rounded-xl border border-dashed border-slate-300 px-3.5 py-3 text-left text-base font-medium text-navy-700 transition hover:border-navy-400 hover:bg-navy-50">
                    <Plus size={16} aria-hidden /> Something else — add a new type
                  </button>
                ))}
            </div>
          )}
        </div>

        {/* 2 How much (kept in the page while you go back, so nothing typed is lost) */}
        <div className={cn("space-y-5", step === 2 ? "" : "hidden")}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Expense for</p>
              <p className="truncate text-xl font-semibold text-slate-900">
                {typeName || "—"}
                {!category && typeName && <span className="ml-2 rounded-full bg-navy-50 px-2 py-0.5 align-middle text-[11px] font-semibold text-navy-700">New type</span>}
              </p>
            </div>
            <button type="button" onClick={() => setStep(1)} className="shrink-0 text-sm font-medium text-navy-700 hover:underline">
              Change
            </button>
          </div>

          <Field label="How much?" name="amountShown" id={id("amount")} error={fe.amount} required>
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-500">TSh</span>
              <input ref={amountRef} id={id("amount")} inputMode="numeric" autoComplete="off" placeholder="0" value={amount ? Number(amount).toLocaleString("en-US") : ""} onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 12))} className={`${inputClass(fe.amount)} h-14 pl-14 text-3xl font-semibold tabular-nums`} />
            </div>
          </Field>

          <div>
            <p className="label" id={id("account")}>
              Paid from
            </p>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-labelledby={id("account")}>
              {accounts.map((a) => (
                <button key={a.id} type="button" role="radio" aria-checked={a.id === accountId} onClick={() => (setAccountId(a.id), setAccountChanged(true))} className={chip(a.id === accountId)}>
                  <span className="block">{a.name}</span>
                  {(kindOf(a) || a.accountNumber) && (
                    <span className="block truncate text-[11px] font-normal text-slate-500">
                      {kindOf(a)}
                      {a.accountNumber ? `${kindOf(a) ? " · " : ""}${a.accountNumber}` : ""}
                    </span>
                  )}
                </button>
              ))}
            </div>
            {accountError && <p className="field-error mt-1.5">{accountError}</p>}
          </div>

          <Field label="Details (optional)" name="description" id={id("desc")} error={fe.description}>
            <input id={id("desc")} name="description" autoComplete="off" defaultValue={v.description ?? ""} placeholder="e.g. Taxi to deliver 4 cartons to Mwenge" className={inputClass(fe.description)} />
          </Field>

          <details className="group rounded-lg border border-line px-3 py-2.5" open={Boolean(fe.expenseDate || fe.receipt)}>
            <summary className="cursor-pointer list-none text-sm font-medium text-slate-600 group-open:mb-3">Add a receipt photo, a note, or change the date</summary>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Date" name="expenseDate" id={id("date")} error={fe.expenseDate}>
                <input id={id("date")} type="date" name="expenseDate" defaultValue={v.expenseDate ?? today} max={today} className={inputClass(fe.expenseDate)} />
              </Field>
              <Field label="Note (optional)" name="notes" id={id("notes")}>
                <input id={id("notes")} name="notes" autoComplete="off" defaultValue={v.notes ?? ""} className="input" />
              </Field>
              <Field label="Receipt photo (optional)" name="receipt" id={id("receipt")} error={fe.receipt} className="sm:col-span-2">
                <label htmlFor={id("receipt")} className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-sm text-slate-600 hover:border-navy-300 hover:bg-navy-50">
                  <Camera size={16} />
                  <input id={id("receipt")} type="file" name="receipt" accept="image/*" className="w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium" />
                </label>
              </Field>
            </div>
          </details>
        </div>
      </div>

      {step === 2 && (
        <div className="border-t border-line px-4 py-3 sm:px-5">
          <p className="mb-2.5 text-xs text-slate-500">{limitText}</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep(1)} className="btn-secondary shrink-0" aria-label="Back">
              <ArrowLeft size={16} aria-hidden /> Back
            </button>
            <SubmitButton pendingLabel="Saving…" className="btn-primary flex-1">
              Save expense
            </SubmitButton>
          </div>
        </div>
      )}
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
