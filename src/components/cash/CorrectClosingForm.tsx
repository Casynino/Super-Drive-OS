"use client";

import { useActionState, useId, useState } from "react";
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

/** The owner types the cash that was really in the till; the system works out how much to add or remove and keeps the reason. */
export default function CorrectClosingForm({ action, closingId, current, symbol, submissionKey }: { action: Action; closingId: string; current: string; symbol: string; submissionKey: string }) {
  const [state, formAction] = useActionState(action, initial);
  const uid = useId();
  const id = (n: string) => `${uid}-${n}`;
  const fe = state.fieldErrors ?? {};
  const v = state.values ?? {};
  const [value, setValue] = useState(v.newCount ?? "");
  const money = (n: number) => `${symbol} ${new Intl.NumberFormat("en-US").format(Math.abs(n))}`;
  const n = num(value);
  const delta = n === null ? null : n - Number(current);

  return (
    <form action={formAction} noValidate className="space-y-3">
      <input type="hidden" name="closingId" value={closingId} />
      <input type="hidden" name="submissionKey" value={submissionKey} />
      {state.error && !Object.keys(fe).length && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.message}</Alert>}
      <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-start">
        <Field label="Cash really in the till" name="newCount" id={id("n")} error={fe.newCount}>
          <input id={id("n")} name="newCount" inputMode="numeric" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder={current} className={cn(inputClass(fe.newCount), "tabular-nums")} />
        </Field>
        <Field label="Why" name="reason" id={id("r")} error={fe.reason}>
          <input id={id("r")} name="reason" autoComplete="off" defaultValue={v.reason ?? ""} placeholder="e.g. recounted with the attendant, the rest was found" className={inputClass(fe.reason)} />
        </Field>
        <div className="sm:pt-[1.65rem]">
          <SubmitButton pendingLabel="Saving…" disabled={delta === null || delta === 0}>
            Correct
          </SubmitButton>
        </div>
      </div>
      <p className="text-xs text-slate-500" aria-live="polite">
        {delta === null || delta === 0 ? `On record now: ${money(Number(current))}. The amount you type replaces what was counted.` : `This ${delta > 0 ? "adds" : "removes"} ${money(delta)} so the cash counted becomes ${money(n ?? 0)}.`}
      </p>
    </form>
  );
}
