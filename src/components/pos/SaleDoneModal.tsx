"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, FileDown, Printer } from "lucide-react";
import Modal from "@/components/Modal";
import PickupNoteSheet, { type PickupNoteData } from "@/components/warehouse/PickupNoteSheet";
import { loadPickupPreview, loadSaleDone, type SaleDone } from "@/app/(app)/till/actions";
import { cn } from "@/lib/utils";

// an A5 sheet (148 x 210 mm) in pixels
const SHEET_W = 559.37;
const SHEET_H = 793.7;

const act = "inline-flex h-10 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold transition";

/**
 * After Complete sale: the pickup note itself, its real shape (an A5 sheet with its QR code), shown on the dark screen as paper, with
 * only a few actions under it: Print, Download PDF, Open, and New sale. No card around it, no receipt. The till never leaves the page.
 * On screen the note wears the system's colours; on paper it prints in its own.
 */
export default function SaleDoneModal({ saleId, currency, onNewSale, onLoaded }: { saleId: string | null; currency: { symbol: string; decimals: number }; onNewSale: () => void; onLoaded?: (s: SaleDone) => void }) {
  const [sale, setSale] = useState<SaleDone | null>(null);
  const [note, setNote] = useState<PickupNoteData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(0.8);
  const nf = useMemo(() => new Intl.NumberFormat("en-US", { minimumFractionDigits: currency.decimals, maximumFractionDigits: currency.decimals }), [currency.decimals]);
  const fmt = (v: string | number) => `${currency.symbol} ${nf.format(Number(v))}`;

  // the sheet is as big as the screen allows (never bigger than real size)
  useEffect(() => {
    const fit = () => setScale(Math.max(0.4, Math.min(1, (window.innerHeight - 190) / SHEET_H, (window.innerWidth - 28) / SHEET_W)));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

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
  const pickup = sale?.pickup ?? null;
  const line = sale ? [sale.saleNo, sale.status === "PAID" ? "Paid" : owed > 0 ? `${fmt(owed)} on credit${sale.dueDate ? ` · pay by ${sale.dueDate}` : ""}` : "", fmt(sale.total)].filter(Boolean).join("  ·  ") : "";

  return (
    <Modal open={Boolean(saleId)} onClose={onNewSale} label="Sale complete" bare>
      <div className="flex flex-col items-center gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-white">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white">
            <Check size={14} strokeWidth={3} />
          </span>
          <span className="font-semibold">Sale complete</span>
          {sale && <span className="font-mono text-xs text-white/70">{line}</span>}
        </div>

        {error ? (
          <div className="rounded-xl bg-white px-6 py-8 text-sm text-brand-red-dark">{error}</div>
        ) : pickup ? (
          /* the note, as it is on paper */
          <div style={{ width: SHEET_W * scale, height: SHEET_H * scale }} className="overflow-hidden rounded-sm shadow-[0_18px_50px_rgba(0,0,0,0.55)] ring-1 ring-white/20">
            {note ? (
              <div style={{ width: "148mm", height: "210mm", transform: `scale(${scale})`, transformOrigin: "top left" }}>
                <PickupNoteSheet d={note} preview />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center bg-white/10 text-sm text-white/70">Getting the note…</div>
            )}
          </div>
        ) : sale ? (
          <div className="w-[min(92vw,26rem)] rounded-xl bg-white px-6 py-6 text-center">
            <p className="text-2xl font-bold text-slate-900">{fmt(sale.total)}</p>
            <p className="mt-1 text-sm text-slate-600">{sale.customer ?? "Walk-in customer"} · stock is updated</p>
            <Link href={`/sales/${sale.id}/receipt?first=1`} target="_blank" rel="noopener" className="mt-3 inline-block text-sm font-medium text-navy-700 underline">
              Print receipt
            </Link>
          </div>
        ) : (
          <div className="flex items-center justify-center rounded-sm bg-white/10 text-sm text-white/70" style={{ width: SHEET_W * scale, height: SHEET_H * scale }}>
            Getting the details…
          </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-2">
          {pickup && (
            <>
              <Link href={`/print/pickup/${pickup.id}?print=1`} target="_blank" rel="noopener" className={cn(act, "border-white bg-white text-navy-800 hover:bg-slate-100")}>
                <Printer size={16} /> Print
              </Link>
              <Link href={`/print/pickup/${pickup.id}?print=1&save=1`} target="_blank" rel="noopener" className={cn(act, "border-white/40 bg-white/10 text-white hover:bg-white/20")}>
                <FileDown size={16} /> Download PDF
              </Link>
              <Link href={`/print/pickup/${pickup.id}`} target="_blank" rel="noopener" className={cn(act, "border-white/40 bg-white/10 text-white hover:bg-white/20")}>
                <ExternalLink size={16} /> Open
              </Link>
            </>
          )}
          <button type="button" autoFocus className={cn(act, "border-navy-600 bg-navy-600 px-6 text-white hover:bg-navy-700")} onClick={onNewSale}>
            New sale
          </button>
        </div>
      </div>
    </Modal>
  );
}
