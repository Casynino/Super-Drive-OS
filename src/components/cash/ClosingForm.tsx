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
  // closing banks what was counted, all of it, by default; the person can keep some back or not bank today
  const [mode, setMode] = useState<"all" | "some" | "none">(bankable ? "all" : "none");
  const [keep, setKeep] = useState("");
  const [account, setAccount] = useState(v.bankAccountId ?? bankAccounts[0]?.id ?? "");
  const [sure, setSure] = useState(false);

  const money = (n: number) => `${symbol} ${new Intl.NumberFormat("en-US").format(Math.abs(n))}`;
  const exp = Number(expected);
  const c = num(counted);
  const diff = c === null ? null : c - exp;
  const keepN = mode === "some" ? num(keep) ?? 0 : 0;
  const dep = c === null || mode === "none" ? 0 : Math.max(c - keepN, 0);
  const left = c === null ? null : c - dep;
  const tooMuch = mode === "some" && c !== null && keepN > c;
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
        <Step n={2} title="Bank the money">
          {bankAccounts.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">There is no bank account yet. The owner adds one in Accounts.</p>
          ) : (
            <>
              <div className="mt-2 inline-flex flex-wrap rounded-xl border border-line bg-slate-50 p-1 text-sm font-medium" role="group" aria-label="How much to bank">
                {([["all", "Bank it all", Landmark], ["some", "Keep some", Banknote], ["none", "Don't bank", Banknote]] as const).map(([k, label, Icon]) => (
                  <button key={k} type="button" onClick={() => setMode(k)} aria-pressed={mode === k} className={cn("inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 transition", mode === k ? "bg-navy-700 text-white shadow-sm" : "text-slate-600 hover:text-slate-900")}>
                    <Icon size={15} /> {label}
                  </button>
                ))}
              </div>
              {mode !== "none" && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {dep > 0 && <input type="hidden" name="depositAmount" value={String(dep)} />}
                  {mode === "some" && (
                    <Field label="Keep in the till" name="keep" id={id("keep")}>
                      <input id={id("keep")} inputMode="numeric" autoComplete="off" value={keep} onChange={(e) => setKeep(e.target.value)} placeholder="0" className={cn(inputClass(), "h-11 text-lg font-semibold tabular-nums")} />
                    </Field>
                  )}
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
                  <Field label="Slip reference (optional)" name="bankReference" id={id("ref")} error={fe.bankReference}>
                    <input id={id("ref")} name="bankReference" autoComplete="off" defaultValue={v.bankReference ?? ""} className={cn(inputClass(fe.bankReference), "h-11")} />
                  </Field>
                  <Field label="Photo of the slip (optional)" name="slip" id={id("slip")} error={fe.slip}>
                    <label htmlFor={id("slip")} className="flex h-11 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 text-sm text-slate-600 hover:border-navy-300 hover:bg-navy-50">
                      <Camera size={16} className="shrink-0" />
                      <input id={id("slip")} type="file" name="slip" accept="image/*" className="w-full min-w-0 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-sm file:font-medium" />
                    </label>
                  </Field>
                </div>
              )}
              {tooMuch ? (
                <p className="mt-3 rounded-lg bg-brand-red-soft px-3 py-2 text-sm font-medium text-brand-red-dark">You cannot keep more than you counted.</p>
              ) : (
                <p className={cn("mt-3 rounded-lg px-3 py-2 text-sm", mode === "none" ? "bg-slate-50 text-slate-600" : "bg-emerald-50 text-emerald-900")}>
                  {mode === "none" ? (
                    "Nothing goes to the bank. The counted cash stays in the till."
                  ) : c === null ? (
                    "Count the cash first. All of it goes into the bank account you choose."
                  ) : (
                    <>
                      <strong>{money(dep)}</strong> goes into {picked?.name ?? "the bank"}
                      {left !== null && left > 0 && (
                        <>
                          {" "}· <strong>{money(left)}</strong> stays in the till
                        </>
                      )}
                    </>
                  )}
                </p>
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
