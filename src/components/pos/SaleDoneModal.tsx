"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, FileDown, Plus, Printer, X } from "lucide-react";
import Modal from "@/components/Modal";
import PickupNoteSheet, { type PickupNoteData } from "@/components/warehouse/PickupNoteSheet";
import { loadPickupPreview, loadSaleDone, type SaleDone } from "@/app/(app)/till/actions";
import { cn } from "@/lib/utils";

// an A5 sheet (148 x 210 mm) in pixels
const SHEET_W = 559.37;
const SHEET_H = 793.7;

// small round icon buttons, one calm set, solid so nothing shows through (fixed hex colours: the dark theme swaps the named tokens)
const dot = "group relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-1 ring-white/20 transition hover:scale-105";
const navy = "bg-[#152a4a] text-[#ffffff] hover:bg-[#1c3560]";
const tip = "pointer-events-none absolute left-full top-1/2 ml-2.5 hidden -translate-y-1/2 whitespace-nowrap rounded-md bg-[#ffffff] px-2 py-1 text-xs font-semibold text-[#0e3d6e] opacity-0 shadow-lg transition group-hover:opacity-100 md:block";
const xBtn = "grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#152a4a] text-[#ffffff] ring-1 ring-white/20 transition hover:bg-[#1c3560]";

/**
 * After Complete sale: the pickup note itself, its real shape (an A5 sheet with its QR code), shown on the dark screen as paper, with
 * only a few actions beside it: Print, Download PDF, Open, New sale, and a small X that just closes the note. No title text, no card
 * around it, no receipt. The till never leaves the page.
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
    const fit = () => {
      const side = window.innerWidth >= 768;
      // the note is as big as the space left by the small buttons (beside it on a computer, under it on a phone)
      const maxW = side ? window.innerWidth - 28 - 72 : window.innerWidth - 28;
      const maxH = side ? window.innerHeight - 48 : window.innerHeight - 150;
      setScale(Math.max(0.4, Math.min(1, maxH / SHEET_H, maxW / SHEET_W)));
    };
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

  const pickup = sale?.pickup ?? null;
  
  return (
    <Modal open={Boolean(saleId)} onClose={onNewSale} label="Sale complete" bare>
      <div className="flex flex-col items-center gap-3 md:flex-row md:items-start md:justify-center">
        {/* phone: a small X above the note. It only closes the note: the sale stays completed and nothing is cancelled */}
        <div className="flex w-full justify-end md:hidden" style={{ maxWidth: SHEET_W * scale }}>
          <button type="button" onClick={onNewSale} className={xBtn} aria-label="Close the note (the sale stays completed)" title="Close the note. The sale stays completed.">
            <X size={15} />
          </button>
        </div>

        {error ? (
          <div className="rounded-xl bg-white px-6 py-8 text-sm text-brand-red-dark">{error}</div>
        ) : pickup ? (
          /* the note, as it is on paper */
          <div style={{ width: SHEET_W * scale, height: SHEET_H * scale }} className="shrink-0 overflow-hidden rounded-sm shadow-[0_18px_50px_rgba(0,0,0,0.55)] ring-1 ring-white/20">
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

        {/* the actions: a few small round buttons, in a column beside the note on a computer or tablet, in one row under it on a phone */}
        <div className="flex w-full items-center justify-center gap-2 md:w-10 md:flex-col md:justify-start" style={{ maxWidth: SHEET_W * scale }}>
          <button type="button" onClick={onNewSale} className={cn(xBtn, "group relative hidden md:mb-1 md:grid")} aria-label="Close the note (the sale stays completed)">
            <X size={15} />
            <span className={tip}>Close (the sale stays)</span>
          </button>
          {pickup && (
            <>
              <Link href={`/print/pickup/${pickup.id}?print=1`} target="_blank" rel="noopener" aria-label="Print the note" className={cn(dot, "bg-[#ffffff] text-[#0e3d6e] hover:bg-[#e8eef6]")}>
                <Printer size={17} />
                <span className={tip}>Print</span>
              </Link>
              <Link href={`/print/pickup/${pickup.id}?print=1&save=1`} target="_blank" rel="noopener" aria-label="Download the note as PDF" className={cn(dot, navy)}>
                <FileDown size={17} />
                <span className={tip}>Download PDF</span>
              </Link>
              <Link href={`/print/pickup/${pickup.id}`} target="_blank" rel="noopener" aria-label="Open the note" className={cn(dot, navy)}>
                <ExternalLink size={17} />
                <span className={tip}>Open</span>
              </Link>
            </>
          )}
          <button type="button" autoFocus onClick={onNewSale} aria-label="New sale" className="group relative inline-flex h-10 items-center justify-center gap-1.5 rounded-full bg-[#fdc400] px-4 text-sm font-semibold text-[#0e3d6e] transition hover:brightness-95 md:w-10 md:px-0">
            <Plus size={18} strokeWidth={2.5} />
            <span className="md:hidden">New sale</span>
            <span className={tip}>New sale</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}
