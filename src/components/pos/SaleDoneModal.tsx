"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, FileDown, Printer, Receipt, X } from "lucide-react";
import Modal from "@/components/Modal";
import { loadSaleDone, type SaleDone } from "@/app/(app)/till/actions";
import { cn } from "@/lib/utils";

/** A square action: icon over a short word. Same size everywhere so the pop-up reads as a tidy grid. */
function Tile({ href, icon, label, strong }: { href: string; icon: React.ReactNode; label: string; strong?: boolean }) {
  return (
    <Link href={href} target="_blank" rel="noopener" className={cn("flex flex-col items-center justify-center gap-1.5 rounded-xl border px-2 py-3 text-xs font-semibold transition", strong ? "border-navy-700 bg-navy-700 text-white hover:bg-navy-800" : "border-line bg-white text-slate-700 hover:border-navy-300 hover:bg-slate-50")}>
      {icon}
      {label}
    </Link>
  );
}

const Label = ({ children }: { children: React.ReactNode }) => <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{children}</p>;

/**
 * The pop-up after Complete sale. Left: the sale (who, what, how much, how it was paid). Right: what to do with the papers
 * (pickup note and receipt). Bottom: New sale. The till never leaves the page, so the next customer is one tap away.
 */
export default function SaleDoneModal({ saleId, currency, onNewSale, onLoaded }: { saleId: string | null; currency: { symbol: string; decimals: number }; onNewSale: () => void; onLoaded?: (s: SaleDone) => void }) {
  const [sale, setSale] = useState<SaleDone | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nf = useMemo(() => new Intl.NumberFormat("en-US", { minimumFractionDigits: currency.decimals, maximumFractionDigits: currency.decimals }), [currency.decimals]);
  const fmt = (v: string | number) => `${currency.symbol} ${nf.format(Number(v))}`;

  useEffect(() => {
    if (!saleId) return;
    let alive = true;
    setSale(null);
    setError(null);
    loadSaleDone(saleId).then((r) => {
      if (!alive) return;
      if (r.ok) {
        setSale(r.sale);
        onLoaded?.(r.sale);
      } else setError(r.error);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleId]);

  const owed = sale ? Number(sale.owed) : 0;
  const paid = sale ? Number(sale.paid) : 0;
  const chip = !sale ? null : sale.status === "PAID" ? { text: "Paid", tone: "bg-emerald-100 text-emerald-800" } : { text: sale.status === "PARTIALLY_PAID" ? "Part paid" : "On credit", tone: "bg-amber-100 text-amber-800" };

  return (
    <Modal open={Boolean(saleId)} onClose={onNewSale} label="Sale complete" wide>
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <Check size={20} strokeWidth={2.5} />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-tight text-slate-900">Sale complete</h2>
            <p className="font-mono text-xs text-slate-500">{sale?.saleNo ?? "…"}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {chip && <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", chip.tone)}>{chip.text}</span>}
          <button type="button" className="btn-secondary btn-sm" onClick={onNewSale} aria-label="Close">
            <X size={16} />
          </button>
        </div>
      </div>

      {error ? (
        <p className="px-6 py-10 text-center text-sm text-brand-red-dark">{error}</p>
      ) : !sale ? (
        <p className="px-6 py-12 text-center text-sm text-slate-500">Getting the details…</p>
      ) : (
        <div className="grid min-h-0 flex-1 overflow-y-auto sm:grid-cols-[1.4fr_1fr]">
          <div className="px-5 py-5 sm:px-6">
            <Label>Customer</Label>
            <p className="mt-0.5 text-sm font-semibold text-slate-900">
              {sale.customer ?? "Walk-in customer"}
              {sale.winga && <span className="ml-2 rounded-full bg-oil-400/20 px-2 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-yellow-800 dark:text-oil-400">Winga</span>}
            </p>

            <div className="mt-4 overflow-hidden rounded-xl border border-line">
              <div className="grid grid-cols-[4.5rem_1fr_auto] gap-3 border-b border-line bg-slate-50/70 px-3 py-1.5">
                <Label>Qty</Label>
                <Label>Product</Label>
                <Label>Amount</Label>
              </div>
              <ul className="max-h-44 divide-y divide-line overflow-y-auto text-sm">
                {sale.lines.map((l, i) => (
                  <li key={i} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 px-3 py-2">
                    <span className="font-semibold tabular-nums text-slate-900">
                      {l.qty} <span className="text-xs font-medium text-slate-500">{l.unit}</span>
                    </span>
                    <span className="min-w-0 truncate text-slate-800">{l.name}</span>
                    <span className="font-medium tabular-nums text-slate-900">{fmt(l.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>

            <dl className="mt-4 space-y-1.5 text-sm">
              <div className="flex items-baseline justify-between">
                <dt className="font-semibold text-slate-900">Total</dt>
                <dd className="text-2xl font-bold tracking-tight text-slate-900">{fmt(sale.total)}</dd>
              </div>
              {paid > 0 && (
                <div className="flex justify-between text-slate-600">
                  <dt>Paid{sale.method ? ` · ${sale.method}` : ""}</dt>
                  <dd className="font-medium tabular-nums text-slate-800">{fmt(paid)}</dd>
                </div>
              )}
              {owed > 0 && (
                <div className="flex justify-between font-medium text-brand-red-dark">
                  <dt>On credit{sale.dueDate ? ` · pay by ${sale.dueDate}` : ""}</dt>
                  <dd className="tabular-nums">{fmt(owed)}</dd>
                </div>
              )}
            </dl>
          </div>

          <div className="space-y-5 border-t border-line bg-slate-50/60 px-5 py-5 sm:border-l sm:border-t-0">
            {sale.pickup ? (
              <div>
                <Label>Pickup note</Label>
                <p className="mb-2 mt-0.5 font-mono text-sm font-semibold text-slate-900">{sale.pickup.noteNo}</p>
                <div className="grid grid-cols-3 gap-2">
                  <Tile strong href={`/print/pickup/${sale.pickup.id}?print=1`} icon={<Printer size={18} />} label="Print" />
                  <Tile href={`/print/pickup/${sale.pickup.id}?print=1&save=1`} icon={<FileDown size={18} />} label="PDF" />
                  <Tile href={`/print/pickup/${sale.pickup.id}`} icon={<ExternalLink size={18} />} label="Open" />
                </div>
                <p className="mt-2 text-xs text-slate-500">Give it to the customer. It is also the delivery note.</p>
              </div>
            ) : (
              <p className="text-xs text-slate-500">Stock is updated.</p>
            )}
            <div>
              <Label>Receipt</Label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Tile href={`/sales/${sale.id}/receipt?first=1`} icon={<Receipt size={18} />} label="Print receipt" />
                <Tile href={`/sales/${sale.id}`} icon={<ExternalLink size={18} />} label="Open sale" />
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="border-t border-line px-5 py-4 sm:px-6">
        <button type="button" autoFocus className="btn-primary min-h-11 w-full text-base" onClick={onNewSale}>
          New sale
        </button>
      </div>
    </Modal>
  );
}
