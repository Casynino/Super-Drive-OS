"use client";

import { useActionState, useId, useState } from "react";
import { Check } from "lucide-react";
import { Alert } from "@/components/ui";
import { Field, SubmitButton, inputClass } from "@/components/FormBits";
import type { ActionState } from "@/lib/action";
import { cn } from "@/lib/utils";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;
const initial: ActionState = {};
const num = (s: string) => {
  const n = Number(s.replace(/[,\s]/g, ""));
  return Number.isFinite(n) && s.trim() !== "" ? n : null;
};

const REASONS = ["Recounted with the attendant", "The missing cash was found", "A sale was not recorded", "Wrong change was given"];

/**
 * The owner corrects a closed day: type the cash that was really in the till (or press the button for what the system expected)
 * and give a reason (one press fills the usual ones). The system works out how much to add or remove.
 */
export default function CorrectClosingForm({ action, closingId, current, expected, symbol, submissionKey }: { action: Action; closingId: string; current: string; expected: string; symbol: string; submissionKey: string }) {
  const [state, formAction] = useActionState(action, initial);
  const uid = useId();
  const id = (n: string) => `${uid}-${n}`;
  const fe = state.fieldErrors ?? {};
  const v = state.values ?? {};
  const [value, setValue] = useState(v.newCount ?? "");
  const [reason, setReason] = useState(v.reason ?? "");
  const money = (n: number) => `${symbol} ${new Intl.NumberFormat("en-US").format(Math.abs(n))}`;
  const n = num(value);
  const delta = n === null ? null : n - Number(current);
  const exp = Number(expected);
  const off = Number(current) !== exp;

  return (
    <form action={formAction} noValidate className="space-y-4">
      <input type="hidden" name="closingId" value={closingId} />
      <input type="hidden" name="submissionKey" value={submissionKey} />
      {state.error && !Object.keys(fe).length && <Alert>{state.error}</Alert>}
      {state.ok && (
        <Alert kind="success">
          <span className="flex items-center gap-2">
            <Check size={16} /> {state.message}
          </span>
        </Alert>
      )}

      {off && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Step 1 · what was really in the till?</p>
          <button type="button" onClick={() => setValue(String(exp))} className={cn("mt-2 inline-flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-medium transition", n === exp ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-line bg-white text-slate-700 hover:border-navy-300 hover:bg-navy-50")}>
            {n === exp && <Check size={15} />} It was what the system expected: {money(exp)}
          </button>
          <span className="mx-2 text-xs text-slate-500">or type the amount</span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Field label="Cash really in the till" name="newCount" id={id("n")} error={fe.newCount}>
          <input id={id("n")} name="newCount" inputMode="numeric" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder={current} className={cn(inputClass(fe.newCount), "h-12 text-lg font-semibold tabular-nums")} />
        </Field>
        <Field label="Why" name="reason" id={id("r")} error={fe.reason}>
          <input id={id("r")} name="reason" autoComplete="off" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Say what happened" className={cn(inputClass(fe.reason), "h-12")} />
        </Field>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {REASONS.map((r) => (
          <button key={r} type="button" onClick={() => setReason(r)} className={cn("rounded-full border px-3 py-1 text-xs font-medium transition", reason === r ? "border-navy-700 bg-navy-700 text-white" : "border-line bg-white text-slate-600 hover:border-navy-200 hover:text-slate-900")}>
            {r}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Saving…" disabled={delta === null || delta === 0}>
          Save the correction
        </SubmitButton>
        <p className="text-sm text-slate-600" aria-live="polite">
          {delta === null || delta === 0 ? `On record now: ${money(Number(current))}` : `This ${delta > 0 ? "adds" : "removes"} ${money(delta)}, so the cash counted becomes ${money(n ?? 0)}.`}
        </p>
      </div>
    </form>
  );
}
