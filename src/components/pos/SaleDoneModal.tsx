"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, FileDown, Printer, Receipt } from "lucide-react";
import Modal from "@/components/Modal";
import { loadSaleDone, type SaleDone } from "@/app/(app)/till/actions";
import { cn } from "@/lib/utils";

const small = "inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 text-xs font-semibold text-slate-700 transition hover:border-navy-200 hover:bg-slate-50";

/**
 * The pop-up after Complete sale: the sale in short, then what to do next (open the sale, print the receipt, the pickup note for the
 * warehouse: open, print or save as PDF) and New sale. The till never leaves the page, so the next customer is one tap away.
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

  const credit = sale ? Number(sale.owed) > 0 : false;
  const chip = !sale ? null : sale.status === "PAID" ? { text: "Paid", tone: "bg-emerald-100 text-emerald-800" } : sale.status === "PARTIALLY_PAID" ? { text: "Part paid", tone: "bg-amber-100 text-amber-800" } : { text: "On credit", tone: "bg-amber-100 text-amber-800" };

  return (
    <Modal open={Boolean(saleId)} onClose={onNewSale} label="Sale complete">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-2 pt-7">
        <div className="text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <Check size={28} strokeWidth={2.5} />
          </span>
          <h2 className="mt-3 text-xl font-semibold text-slate-900">Sale complete</h2>
          {sale ? (
            <>
              <p className="mt-0.5 font-mono text-sm text-slate-500">{sale.saleNo}</p>
              <p className="mt-3 text-3xl font-bold tracking-tight text-slate-900">{fmt(sale.total)}</p>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-xs">
                {chip && <span className={cn("rounded-full px-2.5 py-0.5 font-semibold", chip.tone)}>{chip.text}</span>}
                {sale.method && Number(sale.paid) > 0 && <span className="rounded-full bg-slate-100 px-2.5 py-0.5 font-medium text-slate-600">{sale.method}</span>}
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 font-medium text-slate-600">{sale.customer ?? "Walk-in"}{sale.winga ? " · Winga" : ""}</span>
              </div>
              {credit && (
                <p className="mt-2 text-sm text-slate-600">
                  {Number(sale.paid) > 0 ? `${fmt(sale.paid)} paid now · ` : ""}
                  <span className="font-semibold text-brand-red-dark">{fmt(sale.owed)} on credit</span>
                  {sale.dueDate ? ` · pay by ${sale.dueDate}` : ""}
                </p>
              )}
            </>
          ) : error ? (
            <p className="mt-3 text-sm text-brand-red-dark">{error}</p>
          ) : (
            <p className="mt-3 text-sm text-slate-500">Getting the details…</p>
          )}
        </div>

        {sale && (
          <>
            <ul className="mt-5 max-h-40 divide-y divide-line overflow-y-auto rounded-xl border border-line text-sm">
              {sale.lines.map((l, i) => (
                <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0 truncate text-slate-800">
                    <span className="font-medium">{l.qty} {l.unit}</span> · {l.name}
                  </span>
                  <span className="shrink-0 font-medium tabular-nums text-slate-900">{fmt(l.amount)}</span>
                </li>
              ))}
            </ul>

            {sale.pickup ? (
              <div className="mt-4 rounded-xl border border-oil-400/40 bg-oil-400/[0.07] px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Pickup note</p>
                    <p className="font-mono text-base font-semibold text-slate-900">{sale.pickup.noteNo}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Link href={`/print/pickup/${sale.pickup.id}`} target="_blank" rel="noopener" className={small}>
                      <ExternalLink size={13} /> Open
                    </Link>
                    <Link href={`/print/pickup/${sale.pickup.id}?print=1`} target="_blank" rel="noopener" className={small}>
                      <Printer size={13} /> Print
                    </Link>
                    <Link href={`/print/pickup/${sale.pickup.id}?print=1&save=1`} target="_blank" rel="noopener" className={small}>
                      <FileDown size={13} /> PDF
                    </Link>
                  </div>
                </div>
                <p className="mt-1.5 text-xs text-slate-600">Give it to the customer: the warehouse scans its QR code to hand over the goods.</p>
              </div>
            ) : (
              <p className="mt-4 text-center text-xs text-slate-500">Stock is updated.</p>
            )}
          </>
        )}
      </div>

      <div className="grid gap-2 px-6 pb-6 pt-3">
        <button type="button" autoFocus className="btn-primary min-h-11 w-full text-base" onClick={onNewSale}>
          New sale
        </button>
        {sale && (
          <div className="grid grid-cols-2 gap-2">
            <Link href={`/sales/${sale.id}`} target="_blank" rel="noopener" className="btn-secondary justify-center">
              <ExternalLink size={15} /> Open sale
            </Link>
            <Link href={`/sales/${sale.id}/receipt?first=1`} target="_blank" rel="noopener" className="btn-secondary justify-center">
              <Receipt size={15} /> Print receipt
            </Link>
          </div>
        )}
      </div>
    </Modal>
  );
}
