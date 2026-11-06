"use client";

import { useActionState, useId, useState } from "react";
import { Camera } from "lucide-react";
import { Alert } from "@/components/ui";
import AccountSelect, { type FormAccount } from "@/components/cash/AccountSelect";
import { Field, SubmitButton, inputClass } from "@/components/FormBits";
import type { ActionState } from "@/lib/action";
import { cn } from "@/lib/utils";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;
const initial: ActionState = {};

const num = (s: string) => {
  const n = Number(s.replace(/[,\s]/g, ""));
  return Number.isFinite(n) && s.trim() !== "" ? n : null;
};

export default function ClosingForm({
  action,
  day,
  expected,
  symbol,
  canDeposit,
  submissionKey,
  bankAccounts,
}: {
  action: Action;
  day: string;
  /** expected cash, as a plain number string */
  expected: string;
  symbol: string;
  canDeposit: boolean;
  submissionKey: string;
  bankAccounts: FormAccount[];
}) {
  const [state, formAction] = useActionState(action, initial);
  const uid = useId();
  const id = (n: string) => `${uid}-${n}`;
  const fe = state.fieldErrors ?? {};
  const v = state.values ?? {};
  const [counted, setCounted] = useState(v.countedCash ?? "");
  const [deposit, setDeposit] = useState(v.depositAmount ?? "");
  const [bank, setBank] = useState(Boolean(v.depositAmount));
  const [sure, setSure] = useState(false);

  const money = (n: number) => `${symbol} ${new Intl.NumberFormat("en-US").format(Math.abs(n))}`;
  const exp = Number(expected);
  const c = num(counted);
  const diff = c === null ? null : c - exp;
  const dep = bank ? num(deposit) ?? 0 : 0;
  const left = c === null ? null : c - dep;

  return (
    <form action={formAction} noValidate className="space-y-5" onSubmit={(e) => { if (!sure || c === null) e.preventDefault(); }}>
      <input type="hidden" name="submissionKey" value={submissionKey} />
      <input type="hidden" name="day" value={day} />
      {state.error && <Alert>{state.error}</Alert>}

      <section>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Step 1</p>
        <h3 className="text-base font-semibold text-slate-900">Count the cash in the till</h3>
        <p className="mt-0.5 text-sm text-slate-500">Count the notes and coins, then type the total.</p>
        <Field label="Cash counted" name="countedCash" id={id("counted")} error={fe.countedCash} className="mt-3">
          <input
            id={id("counted")}
            name="countedCash"
            inputMode="numeric"
            autoComplete="off"
            value={counted}
            onChange={(e) => setCounted(e.target.value)}
            placeholder="0"
            className={cn(inputClass(fe.countedCash), "h-14 text-2xl font-semibold tabular-nums")}
          />
        </Field>
        <div
          aria-live="polite"
          className={cn(
            "mt-3 rounded-lg border px-3.5 py-3 text-sm",
            diff === null ? "border-slate-200 bg-slate-50 text-slate-500" : diff === 0 ? "border-emerald-200 bg-emerald-50 text-emerald-800" : diff < 0 ? "border-red-200 bg-brand-red-soft text-brand-red-dark" : "border-amber-200 bg-oil-soft text-yellow-900",
          )}
        >
          {diff === null ? "Type the counted amount to see if it matches." : diff === 0 ? "The count matches exactly." : diff < 0 ? `Short by ${money(diff)}. Count again before you submit.` : `${money(diff)} more than expected. Count again before you submit.`}
        </div>
        {diff !== null && diff !== 0 && (
          <Field label="What do you think caused the difference? (optional)" name="notes" id={id("notes")} className="mt-3">
            <input id={id("notes")} name="notes" autoComplete="off" defaultValue={v.notes ?? ""} className="input" placeholder="e.g. gave wrong change to a customer" />
          </Field>
        )}
      </section>

      {canDeposit && (
        <section className="border-t border-line pt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Step 2 · optional</p>
          <h3 className="text-base font-semibold text-slate-900">Bank deposit</h3>
          <label className="mt-2 flex cursor-pointer items-center gap-2.5 text-sm text-slate-700">
            <input type="checkbox" checked={bank} onChange={(e) => setBank(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
            I am taking some of this cash to the bank now
          </label>
          {bank && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Amount deposited" name="depositAmount" id={id("dep")} error={fe.depositAmount} hint="You can deposit part of it. The rest stays as cash on hand.">
                <div className="flex gap-2">
                  <input id={id("dep")} name="depositAmount" inputMode="numeric" autoComplete="off" value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="0" className={cn(inputClass(fe.depositAmount), "tabular-nums")} />
                  {c !== null && c > 0 && (
                    <button type="button" className="btn-secondary btn-sm shrink-0" onClick={() => setDeposit(String(c))}>
                      All
                    </button>
                  )}
                </div>
              </Field>
              <Field label="Into which bank account" name="bankAccountId" id={id("bank")} error={fe.bankAccountId}>
                <AccountSelect accounts={bankAccounts} id={id("bank")} name="bankAccountId" defaultValue={v.bankAccountId} error={fe.bankAccountId} />
              </Field>
              <Field label="Bank reference" name="bankReference" id={id("ref")} error={fe.bankReference} hint="From the deposit slip.">
                <input id={id("ref")} name="bankReference" autoComplete="off" defaultValue={v.bankReference ?? ""} className={inputClass(fe.bankReference)} />
              </Field>
              <Field label="Slip photo (optional)" name="slip" id={id("slip")} error={fe.slip} className="sm:col-span-2">
                <label htmlFor={id("slip")} className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-sm text-slate-600 hover:border-navy-300 hover:bg-navy-50">
                  <Camera size={16} />
                  <input id={id("slip")} type="file" name="slip" accept="image/*" className="w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium" />
                </label>
              </Field>
              {left !== null && dep > 0 && <p className="text-sm text-slate-600 sm:col-span-2">Cash left in the till after the deposit: <strong className="text-slate-900">{money(left)}</strong></p>}
            </div>
          )}
        </section>
      )}

      <section className="border-t border-line pt-5">
        <label className="flex cursor-pointer items-start gap-2.5 text-sm text-slate-700">
          <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300" />
          <span>I counted the cash myself and the amount is correct. I understand a submitted closing cannot be changed.</span>
        </label>
        <div className="mt-4">
          <SubmitButton pendingLabel="Closing the day…" disabled={!sure || c === null}>
            Close the day
          </SubmitButton>
        </div>
      </section>
    </form>
  );
}
