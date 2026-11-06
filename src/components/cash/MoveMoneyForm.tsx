"use client";

import { useActionState, useId, useState } from "react";
import { ArrowLeftRight, ArrowRight } from "lucide-react";
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

export type MoveAccount = { id: string; name: string; accountNumber: string | null; method: string; balance: number };
const REASONS = ["Pay a supplier", "Cash for the till", "Move to the main bank", "Mobile money to the bank", "Money for expenses"];

/** The owner picks where the money leaves and where it goes, the amount and a reason; the page shows both balances before and after. */
export default function MoveMoneyForm({ action, accounts, symbol, submissionKey }: { action: Action; accounts: MoveAccount[]; symbol: string; submissionKey: string }) {
  const [state, formAction] = useActionState(action, initial);
  const uid = useId();
  const id = (n: string) => `${uid}-${n}`;
  const fe = state.fieldErrors ?? {};
  const v = state.values ?? {};
  const [fromId, setFromId] = useState(v.fromId ?? accounts[0]?.id ?? "");
  const [toId, setToId] = useState(v.toId ?? accounts.find((a) => a.id !== (v.fromId ?? accounts[0]?.id))?.id ?? "");
  const [amount, setAmount] = useState(v.amount ?? "");
  const [reason, setReason] = useState(v.reason ?? "");
  const money = (n: number) => `${symbol} ${new Intl.NumberFormat("en-US").format(n)}`;
  const from = accounts.find((a) => a.id === fromId);
  const to = accounts.find((a) => a.id === toId);
  const n = num(amount);
  const tooMuch = n !== null && from !== undefined && n > from.balance;
  const ready = n !== null && n > 0 && from && to && from.id !== to.id && !tooMuch && reason.trim().length >= 3;
  const label = (a: MoveAccount) => `${a.name}${a.accountNumber ? ` · ${a.accountNumber}` : ""} — ${money(a.balance)}`;

  return (
    <form action={formAction} noValidate className="space-y-5">
      <input type="hidden" name="submissionKey" value={submissionKey} />
      {state.error && !Object.keys(fe).length && <Alert>{state.error}</Alert>}

      <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <Field label="Take it from" name="fromId" id={id("from")} error={fe.fromId}>
          <select id={id("from")} name="fromId" value={fromId} onChange={(e) => setFromId(e.target.value)} className={cn(inputClass(fe.fromId), "h-12")}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {label(a)}
              </option>
            ))}
          </select>
        </Field>
        <button type="button" onClick={() => { setFromId(toId); setToId(fromId); }} className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-line bg-white text-slate-600 transition hover:border-navy-300 hover:text-navy-700" title="Swap" aria-label="Swap the two accounts">
          <ArrowLeftRight size={18} />
        </button>
        <Field label="Put it into" name="toId" id={id("to")} error={fe.toId}>
          <select id={id("to")} name="toId" value={toId} onChange={(e) => setToId(e.target.value)} className={cn(inputClass(fe.toId), "h-12")}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {label(a)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="How much" name="amount" id={id("amt")} error={fe.amount}>
        <div className="flex gap-2">
          <input id={id("amt")} name="amount" inputMode="numeric" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className={cn(inputClass(fe.amount), "h-14 text-2xl font-semibold tabular-nums")} />
          {from && from.balance > 0 && (
            <button type="button" className="btn-secondary shrink-0" onClick={() => setAmount(String(from.balance))}>
              All
            </button>
          )}
        </div>
      </Field>

      <div>
        <Field label="Why" name="reason" id={id("why")} error={fe.reason}>
          <input id={id("why")} name="reason" autoComplete="off" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Say why the money moves" className={cn(inputClass(fe.reason), "h-12")} />
        </Field>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {REASONS.map((r) => (
            <button key={r} type="button" onClick={() => setReason(r)} className={cn("rounded-full border px-3 py-1 text-xs font-medium transition", reason === r ? "border-navy-700 bg-navy-700 text-white" : "border-line bg-white text-slate-600 hover:border-navy-200 hover:text-slate-900")}>
              {r}
            </button>
          ))}
        </div>
      </div>

      {from && to && from.id !== to.id && n !== null && n > 0 && (
        <div className={cn("grid items-center gap-3 rounded-xl border px-4 py-3 text-sm sm:grid-cols-[1fr_auto_1fr]", tooMuch ? "border-red-300 bg-brand-red-soft" : "border-line bg-slate-50")}>
          <div>
            <p className="font-semibold text-slate-900">{from.name}</p>
            <p className="text-slate-600">
              {money(from.balance)} → <strong className={cn(tooMuch && "text-brand-red-dark")}>{money(from.balance - n)}</strong>
            </p>
          </div>
          <ArrowRight className="mx-auto text-slate-400" size={18} />
          <div>
            <p className="font-semibold text-slate-900">{to.name}</p>
            <p className="text-slate-600">
              {money(to.balance)} → <strong>{money(to.balance + n)}</strong>
            </p>
          </div>
          {tooMuch && <p className="font-medium text-brand-red-dark sm:col-span-3">There is only {money(from.balance)} in {from.name}.</p>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Moving…" disabled={!ready}>
          Move the money
        </SubmitButton>
        <span className="text-xs text-slate-500">It is not income and not spending: the total of all your money stays the same.</span>
      </div>
    </form>
  );
}
