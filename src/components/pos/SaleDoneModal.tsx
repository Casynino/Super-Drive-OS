"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, FileDown, Printer, X } from "lucide-react";
import Modal from "@/components/Modal";
import PickupNoteSheet, { type PickupNoteData } from "@/components/warehouse/PickupNoteSheet";
import { loadPickupPreview, loadSaleDone, type SaleDone } from "@/app/(app)/till/actions";
import { cn } from "@/lib/utils";

// an A5 sheet (148 x 210 mm) in pixels
const SHEET_W = 559.37;
const SHEET_H = 793.7;

// solid buttons (nothing shows through them), small, one calm set
const btn = "inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition md:justify-start md:px-3 max-md:px-2";
const quiet = "bg-[#152a4a] text-[#ffffff] ring-1 ring-white/15 hover:bg-[#1c3560]";
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
      // the note is as big as the space left by the actions (beside it on a computer, under it on a phone)
      const maxW = side ? window.innerWidth - 28 - 188 : window.innerWidth - 28;
      const maxH = side ? window.innerHeight - 48 : window.innerHeight - 190;
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

        {/* the actions: a small solid panel at the side of the note on a computer or tablet, a row under it on a phone */}
        <div className="flex w-full flex-col gap-2 rounded-2xl bg-[#0b1a30] p-2 ring-1 ring-white/15 md:w-44" style={{ maxWidth: SHEET_W * scale }}>
          <div className={cn("gap-2 md:flex md:flex-col", pickup ? "grid grid-cols-3" : "hidden md:flex")}>
            <button type="button" onClick={onNewSale} className={cn(xBtn, "hidden self-end md:grid")} aria-label="Close the note (the sale stays completed)" title="Close the note. The sale stays completed.">
              <X size={15} />
            </button>
            {pickup && (
              <>
                <Link href={`/print/pickup/${pickup.id}?print=1`} target="_blank" rel="noopener" className={cn(btn, "bg-[#ffffff] text-[#0e3d6e] hover:bg-[#e8eef6]")}>
                  <Printer size={16} /> Print
                </Link>
                <Link href={`/print/pickup/${pickup.id}?print=1&save=1`} target="_blank" rel="noopener" className={cn(btn, quiet)}>
                  <FileDown size={16} /> <span className="md:hidden">PDF</span>
                  <span className="hidden md:inline">Download PDF</span>
                </Link>
                <Link href={`/print/pickup/${pickup.id}`} target="_blank" rel="noopener" className={cn(btn, quiet)}>
                  <ExternalLink size={16} /> Open
                </Link>
              </>
            )}
          </div>
          <button type="button" autoFocus className={cn(btn, "justify-center bg-[#fdc400] px-6 text-[#0e3d6e] hover:brightness-95 md:justify-center")} onClick={onNewSale}>
            New sale
          </button>
        </div>
      </div>
    </Modal>
  );
}
