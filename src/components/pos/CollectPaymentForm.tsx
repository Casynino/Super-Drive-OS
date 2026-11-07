"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Alert } from "@/components/ui";
import { SubmitButton } from "@/components/FormBits";
import type { ActionState } from "@/lib/action";
import AccountButtons from "@/components/cash/AccountButtons";
import { PAYMENT_METHODS, type PayAccount } from "@/lib/sales/types";
import { cn } from "@/lib/utils";

export type OpenInvoice = { id: string; saleNo: string; date: string; dueDate: string | null; total: string; owed: string; overdue: boolean };

type Props = {
  mode: "collect" | "credit";
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  customerId: string;
  invoices: OpenInvoice[];
  /** unallocated advance credit (credit mode: the maximum that can be applied) */
  creditAvailable: number;
  /** the open accounts the money can go into (collect mode) */
  accounts?: PayAccount[];
  submissionKey: string;
  currency: { symbol: string; decimals: number };
  cancelHref: string;
  /** the order the person came from: the amount typed goes to this order first (up to what it still owes) */
  focusSaleId?: string;
};

const initial: ActionState = {};

export default function CollectPaymentForm({ mode, action, customerId, invoices, creditAvailable, accounts = [], submissionKey: key, currency, cancelHref, focusSaleId }: Props) {
  const [state, formAction] = useActionState(action, initial);
  const fe = state.fieldErrors ?? {};
  const [submissionKey] = useState(key);
  const nf = new Intl.NumberFormat("en-US", { minimumFractionDigits: currency.decimals, maximumFractionDigits: currency.decimals });
  const fmt = (n: number) => `${currency.symbol} ${nf.format(n)}`;

  const [accountPick, setAccountPick] = useState("");
  const [methodPick, setMethodPick] = useState<PayAccount["method"]>("CASH"); // only used when no accounts are set up yet
  const account = accounts.find((a) => a.id === accountPick) ?? accounts.find((a) => a.method === "CASH") ?? accounts[0] ?? null;
  const method = account?.method ?? methodPick;
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [keepExtra, setKeepExtra] = useState(false);
  const [alloc, setAlloc] = useState<Record<string, string>>({});

  const num = (s: string | undefined) => (s && s.trim() !== "" && Number.isFinite(Number(s)) ? Number(s) : 0);
  const allocated = invoices.reduce((s, i) => s + num(alloc[i.id]), 0);
  const received = mode === "collect" ? num(amount) : allocated;
  const extra = mode === "collect" ? Math.max(received - allocated, 0) : 0;
  const budget = mode === "collect" ? received : creditAvailable;

  // Oldest invoice first, until the money (or the credit) runs out.
  const autoAllocate = () => {
    let left = budget;
    const next: Record<string, string> = {};
    for (const i of invoices) {
      if (left <= 0) break;
      const take = Math.min(left, Number(i.owed));
      next[i.id] = String(take);
      left -= take;
    }
    setAlloc(next);
  };

  const payload = JSON.stringify({
    customerId,
    ...(mode === "collect" ? { method, accountId: account?.id ?? null, amount, reference: reference.trim() || null, keepExtraAsCredit: keepExtra } : {}),
    notes: notes.trim() || null,
    allocations: invoices.filter((i) => num(alloc[i.id]) > 0).map((i) => ({ saleId: i.id, amount: alloc[i.id]! })),
    submissionKey,
  });

  const overBudget = allocated > budget + 1e-9;

  return (
    <form
      action={formAction}
      noValidate
      className="space-y-5"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
      }}
    >
      <input type="hidden" name="payloadJson" value={payload} />
      {state.error && <Alert>{state.error}</Alert>}
      {fe.credit && <Alert>{fe.credit}</Alert>}

      {mode === "collect" && (
        <section className="card card-pad">
          <h2 className="mb-4 text-base font-semibold text-slate-900">Payment received</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="label" htmlFor="amount">
                Amount received <span className="text-brand-red">*</span>
              </label>
              <input id="amount" className={cn("input", fe.amount && "input-error")} inputMode="decimal" value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  const focus = focusSaleId ? invoices.find((i) => i.id === focusSaleId) : undefined;
                  if (focus) {
                    const take = Math.min(num(e.target.value), Number(focus.owed));
                    setAlloc(take > 0 ? { [focus.id]: String(take) } : {});
                  }
                }}
                placeholder="0"
              />
              {fe.amount && <p className="field-error">{fe.amount}</p>}
            </div>
            <div>
              <p className="label">Paid by</p>
              {accounts.length > 0 ? (
                <AccountButtons accounts={accounts} value={account?.id ?? ""} onChange={setAccountPick} />
              ) : (
                <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Payment method">
                  {PAYMENT_METHODS.map((m) => (
                    <button key={m.value} type="button" role="radio" aria-checked={method === m.value} onClick={() => setMethodPick(m.value)} className={cn("rounded-lg border px-2 py-2 text-sm font-medium transition", method === m.value ? "border-navy-600 bg-navy-50 text-navy-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")}>
                      {m.label}
                    </button>
                  ))}
                </div>
              )}
              {fe.accountId && <p className="field-error">{fe.accountId}</p>}
            </div>
            {method !== "CASH" && (
              <div className="md:col-span-2">
                <label className="label" htmlFor="reference">
                  Transaction reference
                </label>
                <input id="reference" className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Mobile money or bank reference (optional)" />
              </div>
            )}
          </div>
        </section>
      )}

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{mode === "collect" ? "Which invoices is this for?" : "Pay invoices with customer credit"}</h2>
            <p className="text-xs text-slate-500">{mode === "collect" ? "Spread the payment over one or more invoices." : `Credit available: ${fmt(creditAvailable)}`}</p>
          </div>
          <button type="button" className="btn-secondary btn-sm" onClick={autoAllocate} disabled={budget <= 0}>
            Pay oldest first
          </button>
        </div>
        {invoices.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">This customer has no unpaid invoices.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {invoices.map((i) => (
              <li key={i.id} className="grid items-center gap-3 px-4 py-3 sm:grid-cols-[1fr_auto_150px]">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">
                    {i.saleNo} {i.overdue && <span className="badge-red ml-1">Overdue</span>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {i.date}
                    {i.dueDate && ` · due ${i.dueDate}`} · total {fmt(Number(i.total))}
                  </p>
                </div>
                <p className="text-sm sm:text-right">
                  <span className="text-xs text-slate-500">Owed </span>
                  <span className="font-semibold text-brand-red-dark">{fmt(Number(i.owed))}</span>
                </p>
                <div>
                  <label className="sr-only" htmlFor={`alloc-${i.id}`}>
                    Amount for {i.saleNo}
                  </label>
                  <div className="flex gap-1.5">
                    <input id={`alloc-${i.id}`} className={cn("input", fe[`alloc.${i.id}`] && "input-error")} inputMode="decimal" placeholder="0" value={alloc[i.id] ?? ""} onChange={(e) => setAlloc({ ...alloc, [i.id]: e.target.value })} />
                    <button type="button" className="btn-secondary btn-sm shrink-0" onClick={() => setAlloc({ ...alloc, [i.id]: i.owed })} title="Pay this invoice in full">
                      Full
                    </button>
                  </div>
                  {fe[`alloc.${i.id}`] && <p className="field-error">{fe[`alloc.${i.id}`]}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card card-pad">
        <dl className="space-y-1.5 text-sm">
          {mode === "collect" && (
            <div className="flex justify-between text-slate-600">
              <dt>Amount received</dt>
              <dd>{fmt(received)}</dd>
            </div>
          )}
          <div className="flex justify-between text-slate-600">
            <dt>Applied to invoices</dt>
            <dd>{fmt(allocated)}</dd>
          </div>
          {mode === "collect" && (
            <div className={cn("flex justify-between font-medium", extra > 0 ? "text-yellow-800" : "text-slate-500")}>
              <dt>Not applied to any invoice</dt>
              <dd>{fmt(extra)}</dd>
            </div>
          )}
        </dl>
        {overBudget && <p className="field-error">{mode === "collect" ? "The invoices add up to more than the amount received." : "More than the customer's available credit."}</p>}
        {mode === "collect" && extra > 0 && (
          <label className="mt-3 flex items-start gap-2 rounded-lg bg-oil-soft px-3 py-2 text-sm text-yellow-900">
            <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-400" checked={keepExtra} onChange={(e) => setKeepExtra(e.target.checked)} />
            <span>
              Keep {fmt(extra)} as <strong>customer credit</strong> (an advance payment). It stays on their account and can pay future invoices.
            </span>
          </label>
        )}
        <div className="mt-4">
          <label className="label" htmlFor="notes">
            Note
          </label>
          <input id="notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Saving…">{mode === "collect" ? "Record payment" : "Apply credit"}</SubmitButton>
        <Link href={cancelHref} className="btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
