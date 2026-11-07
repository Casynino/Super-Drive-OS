"use client";

import { useActionState, useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, Banknote, Camera, Landmark, Lock, X } from "lucide-react";
import { Alert } from "@/components/ui";
import Modal from "@/components/Modal";
import type { FormAccount } from "@/components/cash/AccountSelect";
import { Field, SubmitButton, inputClass } from "@/components/FormBits";
import type { ActionState } from "@/lib/action";
import { cn } from "@/lib/utils";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;
const initial: ActionState = {};
type Props = {
  action: Action;
  day: string;
  /** expected cash, as a plain number string */
  expected: string;
  symbol: string;
  canDeposit: boolean;
  submissionKey: string;
  bankAccounts: FormAccount[];
  /** what was collected on mobile money and bank accounts since the last closing (to look at, nothing to count) */
  collected?: { name: string; amount: number }[];
  className?: string;
};

const digits = (s: string) => s.replace(/\D/g, "").slice(0, 12);
const group = (s: string) => (s ? Number(s).toLocaleString("en-US") : "");

/**
 * "Close and deposit" button + pop-up with three short steps: 1 Count, 2 Deposit (into the boss's bank account), 3 Close. A closing does not have to be the same day.
 * Same rules as before: the counted cash is compared with what the system expects, the bank part is part of the same closing
 * (the amount leaves the till and enters the chosen account together with it), and a closing cannot be changed.
 */
export default function CloseDayButton({ className, ...props }: Props) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn("btn-primary", className)}>
        <Lock size={16} aria-hidden /> Close and deposit
      </button>
      <Modal open={open} onClose={close} label="Closing">
        <CloseDayForm {...props} onClose={close} />
      </Modal>
    </>
  );
}

type StepKey = "count" | "bank" | "close";

function CloseDayForm({ action, day, expected, symbol, canDeposit, submissionKey, bankAccounts, collected = [], onClose }: Props & { onClose: () => void }) {
  const [state, formAction] = useActionState(action, initial);
  const uid = useId();
  const id = (n: string) => `${uid}-${n}`;
  const fe = state.fieldErrors ?? {};
  const v = state.values ?? {};
  const bankable = canDeposit && bankAccounts.length > 0;
  const steps: { key: StepKey; label: string }[] = bankable ? [{ key: "count", label: "Count" }, { key: "bank", label: "Deposit" }, { key: "close", label: "Close" }] : [{ key: "count", label: "Count" }, { key: "close", label: "Close" }];
  const [step, setStep] = useState<StepKey>("count");
  const [counted, setCounted] = useState(digits(v.countedCash ?? ""));
  // closing banks what was counted, all of it, by default; the person can keep some back or not bank today
  const [mode, setMode] = useState<"all" | "some" | "none">(bankable ? "all" : "none");
  const [keep, setKeep] = useState("");
  const [account, setAccount] = useState(v.bankAccountId ?? bankAccounts[0]?.id ?? "");
  const [sure, setSure] = useState(false);
  const countRef = useRef<HTMLInputElement>(null);
  // with a mouse the cursor starts in the count box; on a phone the keyboard stays closed until it is tapped
  useEffect(() => {
    if (window.matchMedia("(pointer: fine)").matches) countRef.current?.focus();
  }, []);

  // when the server finds a problem, go to the step where it can be fixed
  useEffect(() => {
    if (state.fieldErrors?.countedCash) setStep("count");
    else if (state.fieldErrors?.bankAccountId || state.fieldErrors?.bankReference || state.fieldErrors?.slip) setStep("bank");
  }, [state]);

  const money = (n: number) => `${symbol} ${new Intl.NumberFormat("en-US").format(Math.abs(n))}`;
  const signed = (n: number) => `${n < 0 ? "−" : ""}${symbol} ${new Intl.NumberFormat("en-US").format(Math.abs(n))}`;
  const collectedTotal = collected.reduce((t, c) => t + c.amount, 0);
  const exp = Number(expected);
  const c = counted === "" ? null : Number(counted);
  const diff = c === null ? null : c - exp;
  const keepN = mode === "some" && keep !== "" ? Number(keep) : 0;
  const dep = c === null || mode === "none" ? 0 : Math.max(c - keepN, 0);
  const left = c === null ? null : c - dep;
  const tooMuch = mode === "some" && c !== null && keepN > c;
  const picked = bankAccounts.find((a) => a.id === account);
  const ready = c !== null && sure && !tooMuch;
  const idx = steps.findIndex((s) => s.key === step);
  const next = () => setStep(steps[Math.min(idx + 1, steps.length - 1)]!.key);
  const back = () => setStep(steps[Math.max(idx - 1, 0)]!.key);
  const chip = (on: boolean) => cn("rounded-xl border px-3.5 py-3 text-left text-sm font-medium leading-tight transition", on ? "border-navy-600 bg-navy-50 text-navy-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50");
  const diffTone = diff === null ? "border-line bg-slate-50 text-slate-500" : diff === 0 ? "border-emerald-200 bg-emerald-50 text-emerald-800" : diff < 0 ? "border-red-200 bg-brand-red-soft text-brand-red-dark" : "border-amber-200 bg-oil-soft text-yellow-900";

  return (
    <form action={formAction} noValidate className="flex min-h-0 flex-1 flex-col" onSubmit={(e) => { if (!ready) e.preventDefault(); }}>
      <input type="hidden" name="submissionKey" value={submissionKey} />
      <input type="hidden" name="day" value={day} />
      <input type="hidden" name="countedCash" value={counted} />
      {mode !== "none" && dep > 0 && <input type="hidden" name="depositAmount" value={String(dep)} />}
      {mode !== "none" && bankable && <input type="hidden" name="bankAccountId" value={account} />}

      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div className="flex items-center gap-1">
          {steps.map((s, i) => (
            <span key={s.key} className="flex items-center gap-1">
              {i > 0 && <span className="text-slate-300">—</span>}
              <button type="button" onClick={() => (i <= idx || c !== null) && setStep(s.key)} aria-current={step === s.key ? "step" : undefined} className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold tracking-wide transition", step === s.key ? "bg-navy-700 text-white" : "text-slate-500 hover:text-slate-800")}>
                <span>{i + 1}</span> {s.label}
              </button>
            </span>
          ))}
        </div>
        <button type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900" aria-label="Close">
          <X size={18} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-5">
        {state.error && (
          <div className="mb-4">
            <Alert>{state.error}</Alert>
          </div>
        )}

        {/* 1 Count */}
        <div className={step === "count" ? "space-y-4" : "hidden"}>
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Count the cash in the till</h2>
            <p className="mt-1 text-sm text-slate-500">The system expects {money(exp)}.</p>
          </div>
          <Field label="Cash counted" name="countedShown" id={id("counted")} error={fe.countedCash}>
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-500">{symbol}</span>
              <input ref={countRef} id={id("counted")} inputMode="numeric" autoComplete="off" placeholder="0" value={group(counted)} onChange={(e) => setCounted(digits(e.target.value))} className={cn(inputClass(fe.countedCash), "h-16 pl-14 text-3xl font-bold tabular-nums")} />
            </div>
          </Field>
          <div aria-live="polite" className={cn("rounded-lg border px-3.5 py-2.5 text-sm", diffTone)}>
            {diff === null ? "Type what you counted." : diff === 0 ? "Correct. This is what the system expects." : diff < 0 ? `Short by ${money(diff)}. Count again.` : `${money(diff)} extra. Count again.`}
          </div>
          {collected.length > 0 && (
            <div className="rounded-xl border border-line px-3.5 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Collected on other accounts · nothing to count</p>
              <dl className="mt-2 space-y-1 text-sm">
                {collected.map((c) => (
                  <div key={c.name} className="flex items-baseline justify-between gap-3">
                    <dt className="text-slate-600">{c.name}</dt>
                    <dd className="font-medium tabular-nums text-slate-900">{signed(c.amount)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {diff !== null && diff !== 0 && (
            <Field label="What caused it? (optional)" name="notes" id={id("notes")}>
              <input id={id("notes")} name="notes" autoComplete="off" defaultValue={v.notes ?? ""} className="input" placeholder="e.g. wrong change given" />
            </Field>
          )}
        </div>

        {/* 2 Bank */}
        {bankable && (
          <div className={step === "bank" ? "space-y-4" : "hidden"}>
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Deposit the money</h2>
              <p className="mt-1 text-sm text-slate-500">{c === null ? "Count the cash first." : `You counted ${money(c)}.`}</p>
            </div>
            <div className="inline-flex flex-wrap rounded-xl border border-line bg-slate-50 p-1 text-sm font-medium" role="group" aria-label="How much to deposit">
              {([["all", "Deposit it all", Landmark], ["some", "Keep some", Banknote], ["none", "Keep it all", Banknote]] as const).map(([k, label, Icon]) => (
                <button key={k} type="button" onClick={() => setMode(k)} aria-pressed={mode === k} className={cn("inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 transition", mode === k ? "bg-navy-700 text-white shadow-sm" : "text-slate-600 hover:text-slate-900")}>
                  <Icon size={15} /> {label}
                </button>
              ))}
            </div>
            {mode !== "none" && (
              <>
                {mode === "some" && (
                  <Field label="Keep in the till" name="keepShown" id={id("keep")}>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-500">{symbol}</span>
                      <input id={id("keep")} inputMode="numeric" autoComplete="off" placeholder="0" value={group(keep)} onChange={(e) => setKeep(digits(e.target.value))} className={cn(inputClass(), "h-12 pl-14 text-xl font-semibold tabular-nums")} />
                    </div>
                  </Field>
                )}
                <div>
                  <p className="label" id={id("bank")}>
                    Into which account (the boss's)
                  </p>
                  <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2" role="radiogroup" aria-labelledby={id("bank")}>
                    {bankAccounts.map((a) => (
                      <button key={a.id} type="button" role="radio" aria-checked={a.id === account} onClick={() => setAccount(a.id)} className={chip(a.id === account)}>
                        <span className="block">{a.name}</span>
                        {a.accountNumber && <span className="block truncate text-[11px] font-normal text-slate-500">{a.accountNumber}</span>}
                      </button>
                    ))}
                  </div>
                  {fe.bankAccountId && <p className="field-error mt-1.5">{fe.bankAccountId}</p>}
                </div>
                <details className="group rounded-lg border border-line px-3 py-2.5" open={Boolean(fe.bankReference || fe.slip)}>
                  <summary className="cursor-pointer list-none text-sm font-medium text-slate-600 group-open:mb-3">Add the slip number or a photo of the slip</summary>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Slip reference (optional)" name="bankReference" id={id("ref")} error={fe.bankReference}>
                      <input id={id("ref")} name="bankReference" autoComplete="off" defaultValue={v.bankReference ?? ""} className={inputClass(fe.bankReference)} />
                    </Field>
                    <Field label="Photo of the slip (optional)" name="slip" id={id("slip")} error={fe.slip}>
                      <label htmlFor={id("slip")} className="flex h-[2.75rem] cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 text-sm text-slate-600 hover:border-navy-300 hover:bg-navy-50">
                        <Camera size={16} className="shrink-0" />
                        <input id={id("slip")} type="file" name="slip" accept="image/*" className="w-full min-w-0 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-sm file:font-medium" />
                      </label>
                    </Field>
                  </div>
                </details>
              </>
            )}
            {tooMuch ? (
              <p className="rounded-lg bg-brand-red-soft px-3 py-2 text-sm font-medium text-brand-red-dark">You cannot keep more than you counted.</p>
            ) : (
              <p className={cn("rounded-lg px-3 py-2 text-sm", mode === "none" ? "bg-slate-50 text-slate-600" : "bg-emerald-50 text-emerald-900")}>
                {mode === "none" ? (
                  "Nothing is deposited. The counted cash stays in the till as the balance."
                ) : c === null ? (
                  "Count the cash first. All of it goes into the account you choose."
                ) : (
                  <>
                    <strong>{money(dep)}</strong> goes into {picked?.name ?? "the bank"}, the boss&apos;s account
                    {left !== null && left > 0 && (
                      <>
                        {" "}· <strong>{money(left)}</strong> stays in the till as the balance
                      </>
                    )}
                  </>
                )}
              </p>
            )}
          </div>
        )}

        {/* 3 Close */}
        <div className={step === "close" ? "space-y-4" : "hidden"}>
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Close and deposit</h2>
            <p className="mt-1 text-sm text-slate-500">Check it once more. A closing cannot be changed, and the boss gets the report.</p>
          </div>
          <dl className="divide-y divide-line rounded-xl border border-line text-sm">
            <SummaryRow label="Cash counted" value={c === null ? "—" : money(c)} />
            <SummaryRow label="The system expected" value={money(exp)} />
            <SummaryRow label="Difference" value={diff === null ? "—" : diff === 0 ? "None" : `${diff < 0 ? "Short" : "Extra"} ${money(diff)}`} tone={diff === null || diff === 0 ? undefined : diff < 0 ? "bad" : "warn"} />
            {collected.length > 0 && <SummaryRow label="Collected on other accounts" value={signed(collectedTotal)} />}
            {bankable && <SummaryRow label="Deposited into the boss's account" value={dep > 0 ? `${money(dep)} · ${picked?.name ?? "Bank"}` : "Nothing"} />}
            <SummaryRow label="Stays in the till (the balance)" value={c === null ? "—" : money(left ?? 0)} strong />
          </dl>
          <label className="flex cursor-pointer items-start gap-2.5 text-sm text-slate-700">
            <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300" />
            <span>I counted the cash myself and it is correct.</span>
          </label>
        </div>
      </div>

      <div className="flex gap-2 border-t border-line px-4 py-3 sm:px-5">
        {idx > 0 && (
          <button type="button" onClick={back} className="btn-secondary shrink-0">
            <ArrowLeft size={16} aria-hidden /> Back
          </button>
        )}
        {step !== "close" ? (
          <button type="button" onClick={next} disabled={step === "count" ? c === null : tooMuch} className="btn-primary flex-1">
            Next
          </button>
        ) : (
          <SubmitButton pendingLabel="Closing…" disabled={!ready} className="btn-primary flex-1">
            <Lock size={15} /> Close and deposit
          </SubmitButton>
        )}
      </div>
    </form>
  );
}

function SummaryRow({ label, value, tone, strong }: { label: string; value: string; tone?: "bad" | "warn"; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3.5 py-2.5">
      <dt className="text-slate-600">{label}</dt>
      <dd className={cn("text-right tabular-nums", strong ? "text-base font-bold text-slate-900" : "font-medium text-slate-900", tone === "bad" && "text-brand-red-dark", tone === "warn" && "text-yellow-800")}>{value}</dd>
    </div>
  );
}
