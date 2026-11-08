"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import AccountButtons from "@/components/cash/AccountButtons";
import Modal from "@/components/Modal";
import { collectAtTill, loadTillOrders, type TillData, type TillSummary } from "@/app/(app)/till/actions";
import { PAYMENT_METHODS, type PayAccount } from "@/lib/sales/types";
import { cn } from "@/lib/utils";

/**
 * "Collect payment" as a pop-up: how much he owes, how much he brought, how he paid, and where the money goes (oldest order first).
 * Nothing leaves the page, so a sale in progress at the till is never lost.
 */
export default function CollectModal({ open, onClose, customerId, customerName, accounts, currency, onDone }: { open: boolean; onClose: () => void; customerId: string; customerName: string; accounts: PayAccount[]; currency: { symbol: string; decimals: number }; onDone?: (s: TillSummary) => void }) {
  const [data, setData] = useState<TillData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [accountPick, setAccountPick] = useState("");
  const [methodPick, setMethodPick] = useState<PayAccount["method"]>("CASH"); // only when no accounts are set up
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ paymentId: string; paymentNo: string; summary: TillSummary; paid: number } | null>(null);
  const [submissionKey] = useState(() => crypto.randomUUID());

  const nf = useMemo(() => new Intl.NumberFormat("en-US", { minimumFractionDigits: currency.decimals, maximumFractionDigits: currency.decimals }), [currency.decimals]);
  const fmt = (n: number) => `${currency.symbol} ${nf.format(n)}`;

  useEffect(() => {
    if (!open) return;
    let alive = true;
    loadTillOrders(customerId, "collect").then((r) => {
      if (!alive) return;
      if (r.ok) setData(r);
      else setLoadError(r.error);
    });
    return () => {
      alive = false;
    };
  }, [open, customerId]);

  const account = accounts.find((a) => a.id === accountPick) ?? accounts.find((a) => a.method === "CASH") ?? accounts[0] ?? null;
  const method = account?.method ?? methodPick;
  const owed = data ? Number(data.summary.owed) : 0;
  const received = Number(amount.replace(/,/g, "")) || 0;
  // oldest order first, until the money runs out
  const split = useMemo(() => {
    let left = received;
    return (data?.orders ?? []).map((o) => {
      const take = Math.max(Math.min(left, Number(o.owed)), 0);
      left -= take;
      return { o, take };
    });
  }, [data, received]);
  const tooMuch = received > owed + 1e-9;

  async function submit() {
    if (!data || busy) return;
    setError(null);
    if (!(received > 0)) return setError("Enter the amount he brought.");
    if (tooMuch) return setError("That is more than he owes.");
    setBusy(true);
    const r = await collectAtTill({ customerId, amount: String(received), method, accountId: account?.id ?? null, reference: reference.trim() || null, allocations: split.filter((x) => x.take > 0).map((x) => ({ saleId: x.o.id, amount: String(x.take) })), submissionKey });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setDone({ paymentId: r.paymentId, paymentNo: r.paymentNo, summary: r.summary, paid: received });
    onDone?.(r.summary);
  }

  return (
    <Modal open={open} onClose={onClose} label="Collect payment">
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-900">Collect payment</h2>
          <p className="truncate text-sm text-slate-500">{data?.customer.name ?? customerName}</p>
        </div>
        <button type="button" onClick={onClose} className="btn-secondary btn-sm shrink-0" aria-label="Close">
          <X size={16} />
        </button>
      </div>

      {done ? (
        <div className="px-5 py-8 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <Check size={24} />
          </span>
          <p className="mt-3 text-lg font-semibold text-slate-900">Payment recorded</p>
          <p className="mt-1 text-sm text-slate-600">
            {fmt(done.paid)} received · {done.paymentNo}
          </p>
          <p className="mt-3 text-sm text-slate-500">Still owes</p>
          <p className={cn("text-2xl font-semibold", Number(done.summary.owed) > 0 ? "text-brand-red-dark" : "text-emerald-700")}>{fmt(Number(done.summary.owed))}</p>
          <div className="mt-6 flex justify-center gap-2">
            <Link href={`/payments/${done.paymentId}`} target="_blank" rel="noopener" className="btn-secondary">
              Receipt
            </Link>
            <button type="button" className="btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      ) : loadError ? (
        <p className="px-5 py-8 text-center text-sm text-brand-red-dark">{loadError}</p>
      ) : !data ? (
        <p className="px-5 py-10 text-center text-sm text-slate-500">Loading…</p>
      ) : data.orders.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-slate-500">Nothing is owed: there are no unpaid orders.</p>
      ) : (
        <>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div className="flex items-end justify-between gap-3 rounded-xl border border-line bg-slate-50/70 px-4 py-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">He owes</p>
                <p className="text-2xl font-semibold text-brand-red-dark">{fmt(owed)}</p>
              </div>
              <p className="text-right text-xs text-slate-500">
                {data.summary.openOrders} open order{data.summary.openOrders === 1 ? "" : "s"}
                {data.summary.late && <span className="block font-medium text-brand-red-dark">{fmt(Number(data.summary.late.amount))} is overdue</span>}
              </p>
            </div>

            <div>
              <label className="label" htmlFor="till-amount">
                Amount he brought
              </label>
              <div className="flex gap-2">
                <input id="till-amount" autoFocus className={cn("input flex-1 text-lg font-semibold", tooMuch && "input-error")} inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
                <button type="button" className="btn-secondary shrink-0" onClick={() => setAmount(String(owed))}>
                  All he owes
                </button>
              </div>
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
              {method !== "CASH" && <input className="input mt-2" placeholder="Transaction reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} aria-label="Transaction reference" />}
            </div>

            <div>
              <p className="label">Where the money goes (oldest first)</p>
              <ul className="divide-y divide-line rounded-xl border border-line">
                {split.map(({ o, take }) => (
                  <li key={o.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="font-mono text-[13px] font-semibold text-slate-900">{o.saleNo}</p>
                      <p className={cn("text-xs", o.overdue ? "font-medium text-brand-red-dark" : "text-slate-500")}>
                        {o.overdue ? "Overdue" : o.dueDate ? `Due ${o.dueDate}` : o.date} · owes {fmt(Number(o.owed))}
                      </p>
                    </div>
                    <p className={cn("shrink-0 text-sm font-semibold tabular-nums", take > 0 ? "text-emerald-700" : "text-slate-300")}>{take > 0 ? `+ ${fmt(take)}` : "—"}</p>
                  </li>
                ))}
              </ul>
            </div>
            {error && <p className="field-error">{error}</p>}
            {tooMuch && !error && <p className="field-error">That is more than he owes.</p>}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
            <p className="text-xs text-slate-500">{received > 0 && !tooMuch ? `He will still owe ${fmt(owed - received)}` : ""}</p>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="btn-primary" disabled={busy || !(received > 0) || tooMuch} onClick={submit}>
                {busy ? "Recording…" : "Record payment"}
              </button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
