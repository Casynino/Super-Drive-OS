"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Alert } from "@/components/ui";
import { SubmitButton } from "@/components/FormBits";
import type { ActionState } from "@/lib/action";
import { PAYMENT_METHODS } from "@/lib/sales/types";
import { cn } from "@/lib/utils";

export type ReturnItem = { id: string; name: string; unit: string; sold: string; left: string; lineTotal: string; soldQty: string };

type Props = {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  saleId: string;
  items: ReturnItem[];
  /** current invoice figures, for the refund estimate */
  money: { total: number; returned: number; paid: number; refunded: number };
  currency: { symbol: string; decimals: number };
  canApproveNow: boolean;
  /** how the customer paid (the money goes back the same way) */
  defaultMethod?: string;
  submissionKey: string;
  cancelHref: string;
};

const initial: ActionState = {};

export default function ReturnForm({ action, saleId, items, money, currency, canApproveNow, defaultMethod, submissionKey: key, cancelHref }: Props) {
  const [state, formAction] = useActionState(action, initial);
  const fe = state.fieldErrors ?? {};
  const [submissionKey] = useState(key);
  const nf = new Intl.NumberFormat("en-US", { minimumFractionDigits: currency.decimals, maximumFractionDigits: currency.decimals });
  const fmt = (n: number) => `${currency.symbol} ${nf.format(n)}`;

  const [kind, setKind] = useState<"RETURN" | "CANCEL">("RETURN");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [cond, setCond] = useState<Record<string, "RESELLABLE" | "DAMAGED">>({});
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState(defaultMethod ?? "CASH");
  const [reference, setReference] = useState("");

  // What the customer gets back (an estimate; the server works out the exact figure).
  const unitValue = (i: ReturnItem) => Number(i.lineTotal) / Number(i.soldQty);
  const chosen = kind === "CANCEL" ? items.map((i) => ({ i, q: Number(i.left) })) : items.map((i) => ({ i, q: Number(qty[i.id] || 0) }));
  const valid = chosen.filter((c) => Number.isFinite(c.q) && c.q > 0);
  const returnValue = valid.reduce((s, c) => s + (c.q === Number(c.i.left) ? Number(c.i.lineTotal) * (c.q / Number(c.i.soldQty)) : unitValue(c.i) * c.q), 0);
  const netPaidNow = money.paid - money.refunded;
  const netTotalAfter = money.total - money.returned - returnValue;
  const refundEstimate = Math.max(netPaidNow - netTotalAfter, 0);

  const payload = JSON.stringify({
    saleId,
    kind,
    reason,
    refundMethod: refundEstimate > 0 || kind === "CANCEL" ? method : method,
    refundReference: reference.trim() || null,
    lines: kind === "CANCEL" ? [] : valid.map((c) => ({ saleItemId: c.i.id, quantity: qty[c.i.id]!, condition: cond[c.i.id] ?? "RESELLABLE" })),
    submissionKey,
  });

  return (
    <form action={formAction} noValidate className="space-y-5" onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault(); }}>
      <input type="hidden" name="payloadJson" value={payload} />
      {state.error && <Alert>{state.error}</Alert>}

      <section className="card card-pad">
        <h2 className="mb-3 text-base font-semibold text-slate-900">What do you want to do?</h2>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Return or cancel">
          {([["RETURN", "Take some items back", "The customer returns part of what they bought."], ["CANCEL", "Cancel the whole sale", "Everything goes back and the sale is closed."]] as const).map(([v, t, d]) => (
            <button key={v} type="button" role="radio" aria-checked={kind === v} onClick={() => setKind(v)} className={cn("rounded-xl border p-3.5 text-left transition", kind === v ? "border-navy-600 bg-navy-50" : "border-slate-300 bg-white hover:bg-slate-50")}>
              <span className="block text-sm font-semibold text-slate-900">{t}</span>
              <span className="block text-xs text-slate-500">{d}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="card overflow-hidden">
        <h2 className="border-b border-line px-5 py-3 text-base font-semibold text-slate-900">{kind === "CANCEL" ? "Everything that goes back" : "Which items come back?"}</h2>
        <ul className="divide-y divide-slate-100">
          {items.map((i) => {
            const left = Number(i.left);
            const err = fe[`line.${i.id}`];
            return (
              <li key={i.id} className="grid items-center gap-3 px-5 py-3 sm:grid-cols-[1fr_auto_auto]">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{i.name}</p>
                  <p className="text-xs text-slate-500">
                    Sold {i.sold} {i.unit} · can still return <span className="font-medium text-slate-700">{i.left} {i.unit}</span>
                  </p>
                  {err && <p className="field-error">{err}</p>}
                </div>
                {kind === "CANCEL" ? (
                  <p className="text-sm font-medium text-slate-700 sm:col-span-2 sm:text-right">{left > 0 ? `${i.left} ${i.unit} back on the shelf` : "Already returned"}</p>
                ) : left > 0 ? (
                  <>
                    <div className="flex items-center gap-2">
                      <label className="sr-only" htmlFor={`rq-${i.id}`}>
                        Quantity of {i.name}
                      </label>
                      <input id={`rq-${i.id}`} className={cn("input w-24 text-center", err && "input-error")} inputMode="decimal" placeholder="0" value={qty[i.id] ?? ""} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} />
                      <button type="button" className="btn-secondary btn-sm" onClick={() => setQty({ ...qty, [i.id]: i.left })}>
                        All
                      </button>
                    </div>
                    <select className="input" aria-label={`Condition of ${i.name}`} value={cond[i.id] ?? "RESELLABLE"} onChange={(e) => setCond({ ...cond, [i.id]: e.target.value as "RESELLABLE" | "DAMAGED" })}>
                      <option value="RESELLABLE">Good — back on the shelf</option>
                      <option value="DAMAGED">Damaged — not for sale, to investigate</option>
                    </select>
                  </>
                ) : (
                  <p className="text-sm text-slate-400 sm:col-span-2 sm:text-right">Already returned</p>
                )}
              </li>
            );
          })}
        </ul>
        {fe.lines && <p className="field-error px-5 pb-3">{fe.lines}</p>}
      </section>

      <section className="card card-pad space-y-4">
        <div>
          <label className="label" htmlFor="reason">
            Why? <span className="text-brand-red">*</span>
          </label>
          <textarea id="reason" rows={2} className={cn("input", fe.reason && "input-error")} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. wrong oil grade, bottle leaking, sold by mistake" />
          {fe.reason ? <p className="field-error">{fe.reason}</p> : <p className="hint">Kept permanently with the sale.</p>}
        </div>

        <dl className="space-y-1.5 rounded-lg bg-slate-50 px-4 py-3 text-sm">
          <div className="flex justify-between text-slate-600">
            <dt>Value of the goods coming back</dt>
            <dd className="font-medium text-slate-900">{fmt(returnValue)}</dd>
          </div>
          <div className="flex justify-between text-slate-600">
            <dt>Money to give back to the customer</dt>
            <dd className={cn("font-semibold", refundEstimate > 0 ? "text-brand-red-dark" : "text-slate-900")}>{fmt(refundEstimate)}</dd>
          </div>
          {refundEstimate === 0 && valid.length > 0 && <p className="text-xs text-slate-500">Nothing to refund: the customer had not paid for these items yet, so the amount they owe goes down instead.</p>}
        </dl>

        {(refundEstimate > 0 || kind === "CANCEL") && (
          <div>
            <p className="label">Refund paid by</p>
            <div className="grid max-w-md grid-cols-3 gap-1.5" role="radiogroup" aria-label="Refund method">
              {PAYMENT_METHODS.map((m) => (
                <button key={m.value} type="button" role="radio" aria-checked={method === m.value} onClick={() => setMethod(m.value)} className={cn("rounded-lg border px-2 py-2 text-sm font-medium transition", method === m.value ? "border-navy-600 bg-navy-50 text-navy-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")}>
                  {m.label}
                </button>
              ))}
            </div>
            {method !== "CASH" && <input className="input mt-2.5 max-w-md" placeholder="Transaction reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} aria-label="Refund reference" />}
            {fe.refundMethod && <p className="field-error">{fe.refundMethod}</p>}
          </div>
        )}
      </section>

      {!canApproveNow && <Alert kind="info">A manager or the owner must approve this before stock and money change. They are notified straight away.</Alert>}

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Saving…" className={canApproveNow ? "btn-danger" : "btn-primary"}>
          {canApproveNow ? (kind === "CANCEL" ? "Cancel the sale now" : "Complete the return now") : "Send for approval"}
        </SubmitButton>
        <Link href={cancelHref} className="btn-secondary">
          Back
        </Link>
      </div>
    </form>
  );
}
