"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, FileDown, Printer, X } from "lucide-react";
import Modal from "@/components/Modal";
import PickupNoteSheet, { type PickupNoteData } from "@/components/warehouse/PickupNoteSheet";
import { loadPickupPreview, loadSaleDone, type SaleDone } from "@/app/(app)/till/actions";
import { cn } from "@/lib/utils";

const Label = ({ children }: { children: React.ReactNode }) => <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{children}</p>;

/**
 * The pop-up after Complete sale. It shows the pickup note itself, small (an A5 sheet at half size, with its QR code), and what to do
 * with it: Print, save as PDF, open it. Next to it, the sale in short. New sale at the bottom. The till never leaves the page.
 * On screen the note wears the system's colours; on paper it prints in its own.
 */
export default function SaleDoneModal({ saleId, currency, onNewSale, onLoaded }: { saleId: string | null; currency: { symbol: string; decimals: number }; onNewSale: () => void; onLoaded?: (s: SaleDone) => void }) {
  const [sale, setSale] = useState<SaleDone | null>(null);
  const [note, setNote] = useState<PickupNoteData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nf = useMemo(() => new Intl.NumberFormat("en-US", { minimumFractionDigits: currency.decimals, maximumFractionDigits: currency.decimals }), [currency.decimals]);
  const fmt = (v: string | number) => `${currency.symbol} ${nf.format(Number(v))}`;

  useEffect(() => {
    if (!saleId) return;
    let alive = true;
    setSale(null);
    setNote(null);
    setError(null);
    loadSaleDone(saleId).then((r) => {
      if (!alive) return;
      if (!r.ok) return setError(r.error);
      setSale(r.sale);
      onLoaded?.(r.sale);
      if (r.sale.pickup) loadPickupPreview(r.sale.pickup.id).then((p) => alive && p.ok && setNote(p.data));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleId]);

  const owed = sale ? Number(sale.owed) : 0;
  const paid = sale ? Number(sale.paid) : 0;
  const chip = !sale ? null : sale.status === "PAID" ? { text: "Paid", tone: "bg-emerald-100 text-emerald-800" } : { text: sale.status === "PARTIALLY_PAID" ? "Part paid" : "On credit", tone: "bg-amber-100 text-amber-800" };
  const pickup = sale?.pickup ?? null;
  const act = "inline-flex h-10 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold transition";

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
        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto px-5 py-5 sm:grid-cols-[auto_1fr] sm:px-6">
          {pickup && (
            <div className="mx-auto">
              {/* the real note, first page, at half size: 148 x 210 mm = about 559 x 794 px, shown at 280 x 397 */}
              <div className="overflow-hidden rounded-lg border border-line shadow-sm" style={{ width: 280, height: 397 }}>
                {note ? (
                  <div style={{ width: "148mm", height: "210mm", transform: "scale(0.5)", transformOrigin: "top left" }}>
                    <PickupNoteSheet d={note} preview />
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-slate-500">Getting the note…</div>
                )}
              </div>
            </div>
          )}

          <div className="flex min-w-0 flex-col">
            <Label>Customer</Label>
            <p className="mt-0.5 text-sm font-semibold text-slate-900">
              {sale.customer ?? "Walk-in customer"}
              {sale.winga && <span className="ml-2 rounded-full bg-oil-400/20 px-2 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-yellow-800 dark:text-oil-400">Winga</span>}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {sale.lines.length} product{sale.lines.length === 1 ? "" : "s"}
            </p>

            <dl className="mt-4 space-y-1.5 border-t border-line pt-3 text-sm">
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

            {pickup ? (
              <div className="mt-5">
                <Label>Pickup note</Label>
                <p className="mb-2 mt-0.5 font-mono text-sm font-semibold text-slate-900">{pickup.noteNo}</p>
                <Link href={`/print/pickup/${pickup.id}?print=1`} target="_blank" rel="noopener" className={cn(act, "w-full border-navy-700 bg-navy-700 text-white hover:bg-navy-800")}>
                  <Printer size={16} /> Print note
                </Link>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Link href={`/print/pickup/${pickup.id}?print=1&save=1`} target="_blank" rel="noopener" className={cn(act, "border-line bg-white text-slate-700 hover:border-navy-300 hover:bg-slate-50")}>
                    <FileDown size={16} /> PDF
                  </Link>
                  <Link href={`/print/pickup/${pickup.id}`} target="_blank" rel="noopener" className={cn(act, "border-line bg-white text-slate-700 hover:border-navy-300 hover:bg-slate-50")}>
                    <ExternalLink size={16} /> Open
                  </Link>
                </div>
                <p className="mt-2 text-xs text-slate-500">Give it to the customer. It is also the delivery note.</p>
              </div>
            ) : (
              <div className="mt-5 text-xs text-slate-500">
                Stock is updated. No pickup note: the goods left at once.
                <Link href={`/sales/${sale.id}/receipt?first=1`} target="_blank" rel="noopener" className="ml-1 font-medium text-navy-700 underline">
                  Print receipt
                </Link>
              </div>
            )}
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
