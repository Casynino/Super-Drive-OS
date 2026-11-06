"use client";

import { useActionState, useId, useState } from "react";
import { Banknote, Camera, Landmark, Lock } from "lucide-react";
import { Alert } from "@/components/ui";
import type { FormAccount } from "@/components/cash/AccountSelect";
import { Field, SubmitButton, inputClass } from "@/components/FormBits";
import type { ActionState } from "@/lib/action";
import { cn } from "@/lib/utils";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;
const initial: ActionState = {};

const num = (s: string) => {
  const n = Number(s.replace(/[,\s]/g, ""));
  return Number.isFinite(n) && s.trim() !== "" ? n : null;
};

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="flex gap-3.5">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-navy-700 text-sm font-semibold text-white">{n}</span>
      <div className="min-w-0 flex-1">
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        {children}
      </div>
    </section>
  );
}

/**
 * Close the day in one go: count the cash, choose how much goes to the bank (and which account), confirm.
 * The bank part is part of the same closing: the amount leaves the till and enters the chosen account together with it.
 */
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
  const bankable = canDeposit && bankAccounts.length > 0;
  const [counted, setCounted] = useState(v.countedCash ?? "");
  const [deposit, setDeposit] = useState(v.depositAmount ?? "");
  const [bank, setBank] = useState(bankable);
  const [account, setAccount] = useState(v.bankAccountId ?? bankAccounts[0]?.id ?? "");
  const [sure, setSure] = useState(false);

  const money = (n: number) => `${symbol} ${new Intl.NumberFormat("en-US").format(Math.abs(n))}`;
  const exp = Number(expected);
  const c = num(counted);
  const diff = c === null ? null : c - exp;
  const dep = bank ? num(deposit) ?? 0 : 0;
  const left = c === null ? null : c - dep;
  const tooMuch = c !== null && dep > c;
  const picked = bankAccounts.find((a) => a.id === account);
  const ready = c !== null && sure && !tooMuch;

  return (
    <form action={formAction} noValidate className="space-y-6" onSubmit={(e) => { if (!ready) e.preventDefault(); }}>
      <input type="hidden" name="submissionKey" value={submissionKey} />
      <input type="hidden" name="day" value={day} />
      {state.error && <Alert>{state.error}</Alert>}

      <Step n={1} title="Count the cash in the till">
        <Field label="Cash counted" name="countedCash" id={id("counted")} error={fe.countedCash} className="mt-2">
          <input id={id("counted")} name="countedCash" inputMode="numeric" autoComplete="off" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder="0" className={cn(inputClass(fe.countedCash), "h-14 text-2xl font-semibold tabular-nums")} />
        </Field>
        <div
          aria-live="polite"
          className={cn(
            "mt-2.5 rounded-lg border px-3.5 py-2.5 text-sm",
            diff === null ? "border-line bg-slate-50 text-slate-500" : diff === 0 ? "border-emerald-200 bg-emerald-50 text-emerald-800" : diff < 0 ? "border-red-200 bg-brand-red-soft text-brand-red-dark" : "border-amber-200 bg-oil-soft text-yellow-900",
          )}
        >
          {diff === null ? "Type what you counted. The system compares it with what it expects." : diff === 0 ? "Correct. This is what the system expects." : diff < 0 ? `Short by ${money(diff)}. Count again.` : `${money(diff)} extra. Count again.`}
        </div>
        {diff !== null && diff !== 0 && (
          <Field label="What caused it? (optional)" name="notes" id={id("notes")} className="mt-3">
            <input id={id("notes")} name="notes" autoComplete="off" defaultValue={v.notes ?? ""} className="input" placeholder="e.g. wrong change given" />
          </Field>
        )}
      </Step>

      {canDeposit && (
        <Step n={2} title="Take cash to the bank">
          {bankAccounts.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">There is no bank account yet. The owner adds one in Accounts.</p>
          ) : (
            <>
              <div className="mt-2 inline-flex rounded-xl border border-line bg-slate-50 p-1 text-sm font-medium" role="group" aria-label="Bank some cash?">
                <button type="button" onClick={() => setBank(true)} aria-pressed={bank} className={cn("inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 transition", bank ? "bg-navy-700 text-white shadow-sm" : "text-slate-600 hover:text-slate-900")}>
                  <Landmark size={15} /> Bank some cash
                </button>
                <button type="button" onClick={() => setBank(false)} aria-pressed={!bank} className={cn("inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 transition", !bank ? "bg-navy-700 text-white shadow-sm" : "text-slate-600 hover:text-slate-900")}>
                  <Banknote size={15} /> Keep it all in the till
                </button>
              </div>
              {bank && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="Amount to bank" name="depositAmount" id={id("dep")} error={fe.depositAmount}>
                    <div className="flex gap-2">
                      <input id={id("dep")} name="depositAmount" inputMode="numeric" autoComplete="off" value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="0" className={cn(inputClass(fe.depositAmount), "h-11 text-lg font-semibold tabular-nums")} />
                      {c !== null && c > 0 && (
                        <button type="button" className="btn-secondary shrink-0" onClick={() => setDeposit(String(c))}>
                          All
                        </button>
                      )}
                    </div>
                  </Field>
                  <Field label="Into which account" name="bankAccountId" id={id("bank")} error={fe.bankAccountId}>
                    <select id={id("bank")} name="bankAccountId" value={account} onChange={(e) => setAccount(e.target.value)} className={cn(inputClass(fe.bankAccountId), "h-11")}>
                      {bankAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                          {a.accountNumber ? ` · ${a.accountNumber}` : ""}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Reference from the slip" name="bankReference" id={id("ref")} error={fe.bankReference}>
                    <input id={id("ref")} name="bankReference" autoComplete="off" defaultValue={v.bankReference ?? ""} className={cn(inputClass(fe.bankReference), "h-11")} />
                  </Field>
                  <Field label="Photo of the slip" name="slip" id={id("slip")} error={fe.slip}>
                    <label htmlFor={id("slip")} className="flex h-11 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 text-sm text-slate-600 hover:border-navy-300 hover:bg-navy-50">
                      <Camera size={16} className="shrink-0" />
                      <input id={id("slip")} type="file" name="slip" accept="image/*" className="w-full min-w-0 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-sm file:font-medium" />
                    </label>
                  </Field>
                  {tooMuch ? (
                    <p className="rounded-lg bg-brand-red-soft px-3 py-2 text-sm font-medium text-brand-red-dark sm:col-span-2">You cannot bank more than you counted.</p>
                  ) : (
                    dep > 0 && (
                      <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 sm:col-span-2">
                        <strong>{money(dep)}</strong> goes into {picked?.name ?? "the bank"}
                        {left !== null && (
                          <>
                            {" "}· <strong>{money(left)}</strong> stays in the till
                          </>
                        )}
                      </p>
                    )
                  )}
                </div>
              )}
            </>
          )}
        </Step>
      )}

      <Step n={canDeposit ? 3 : 2} title="Close the day">
        <label className="mt-2 flex cursor-pointer items-start gap-2.5 text-sm text-slate-700">
          <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300" />
          <span>I counted the cash myself and it is correct.</span>
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <SubmitButton pendingLabel="Closing the day…" disabled={!ready}>
            <Lock size={15} /> Close the day
          </SubmitButton>
          <span className="text-xs text-slate-500">A closed day cannot be changed.</span>
        </div>
      </Step>
    </form>
  );
}
