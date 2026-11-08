"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import Modal from "@/components/Modal";
import { loadTillOrders, returnWingaItems, type TillData, type TillSummary } from "@/app/(app)/till/actions";
import { cn } from "@/lib/utils";

/**
 * "Return goods" as a pop-up: the goods the Winga took on his open orders, with how many he brings back. Confirming puts the goods
 * back in the store and lowers what he owes by their value. No money moves.
 */
export default function ReturnModal({ open, onClose, customerId, customerName, currency, onDone }: { open: boolean; onClose: () => void; customerId: string; customerName: string; currency: { symbol: string; decimals: number }; onDone?: (s: TillSummary) => void }) {
  const [data, setData] = useState<TillData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ summary: TillSummary; saleNos: string[] } | null>(null);
  const [submissionKey] = useState(() => crypto.randomUUID());

  const nf = useMemo(() => new Intl.NumberFormat("en-US", { minimumFractionDigits: currency.decimals, maximumFractionDigits: currency.decimals }), [currency.decimals]);
  const fmt = (n: number) => `${currency.symbol} ${nf.format(n)}`;

  useEffect(() => {
    if (!open) return;
    let alive = true;
    loadTillOrders(customerId, "return").then((r) => {
      if (!alive) return;
      if (r.ok) setData(r);
      else setLoadError(r.error);
    });
    return () => {
      alive = false;
    };
  }, [open, customerId]);

  const lines = useMemo(() => (data?.orders ?? []).flatMap((o) => o.lines.map((l) => ({ ...l, saleNo: o.saleNo, orderId: o.id }))), [data]);
  const chosen = lines.map((l) => ({ l, n: Math.min(Math.max(Number(qty[l.id]) || 0, 0), Number(l.qty)) })).filter((x) => x.n > 0);
  const value = chosen.reduce((s, x) => s + x.n * Number(x.l.unitValue), 0);
  const set = (id: string, v: string, max: number) => setQty((q) => ({ ...q, [id]: v === "" ? "" : String(Math.min(Math.max(Number(v) || 0, 0), max)) }));
  const everything = () => setQty(Object.fromEntries(lines.map((l) => [l.id, l.qty])));

  async function confirm() {
    if (busy || chosen.length === 0) return;
    setError(null);
    setBusy(true);
    const r = await returnWingaItems({ customerId, items: chosen.map((x) => ({ saleItemId: x.l.id, quantity: String(x.n) })), submissionKey });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setDone({ summary: r.summary, saleNos: r.saleNos });
    onDone?.(r.summary);
  }

  return (
    <Modal open={open} onClose={onClose} label="Return goods">
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-900">Return goods</h2>
          <p className="truncate text-sm text-slate-500">{data?.customer.name ?? customerName} brings back goods he did not sell</p>
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
          <p className="mt-3 text-lg font-semibold text-slate-900">Goods are back in the store</p>
          <p className="mt-1 text-sm text-slate-600">{done.saleNos.join(", ")} reduced.</p>
          <p className="mt-3 text-sm text-slate-500">He now owes</p>
          <p className={cn("text-2xl font-semibold", Number(done.summary.owed) > 0 ? "text-brand-red-dark" : "text-emerald-700")}>{fmt(Number(done.summary.owed))}</p>
          <button type="button" className="btn-primary mt-6" onClick={onClose}>
            Done
          </button>
        </div>
      ) : loadError ? (
        <p className="px-5 py-8 text-center text-sm text-brand-red-dark">{loadError}</p>
      ) : !data ? (
        <p className="px-5 py-10 text-center text-sm text-slate-500">Loading…</p>
      ) : lines.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-slate-500">No goods to take back: he has no unpaid order with goods still out.</p>
      ) : (
        <>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-slate-600">Goods he took on credit</p>
              <button type="button" className="btn-secondary btn-sm" onClick={everything}>
                Return everything
              </button>
            </div>
            {data.orders.map((o) => (
              <div key={o.id} className="overflow-hidden rounded-xl border border-line">
                <div className="flex items-center justify-between gap-2 border-b border-line bg-slate-50/70 px-3 py-2">
                  <p className="font-mono text-[13px] font-semibold text-slate-900">
                    {o.saleNo} <span className="font-sans text-xs font-normal text-slate-500">· {o.date}</span>
                  </p>
                  <button type="button" className="text-xs font-medium text-navy-700 hover:underline" onClick={() => setQty((q) => ({ ...q, ...Object.fromEntries(o.lines.map((l) => [l.id, l.qty])) }))}>
                    All of this order
                  </button>
                </div>
                <ul className="divide-y divide-line">
                  {o.lines.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">{l.name}</p>
                        <p className="text-xs text-slate-500">
                          took {l.qty} {l.unit} · {fmt(Number(l.unitValue))} each
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <input className="input h-9 w-16 px-2 text-center" inputMode="decimal" placeholder="0" value={qty[l.id] ?? ""} onChange={(e) => set(l.id, e.target.value, Number(l.qty))} aria-label={`How many ${l.name} come back`} />
                        <span className="w-9 text-xs text-slate-500">{l.unit}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {error && <p className="field-error">{error}</p>}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
            <p className="text-xs text-slate-500">{chosen.length > 0 ? `${chosen.length} item${chosen.length === 1 ? "" : "s"} · what he owes goes down by ${fmt(value)}` : "Enter how many come back"}</p>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="btn-primary" disabled={busy || chosen.length === 0} onClick={confirm}>
                {busy ? "Returning…" : "Take goods back"}
              </button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
