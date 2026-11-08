"use client";

import { useState } from "react";
import { Package } from "lucide-react";
import QtySwitch from "@/components/QtySwitch";
import StockChangeButtons from "@/components/inventory/StockChangeButtons";
import { packNote, qtyText, type Pack, type UnitMode } from "@/lib/qty";
import { cn } from "@/lib/utils";

export type WarehouseStockCardProps = {
  id: string;
  name: string;
  sku: string;
  category: string;
  brand: string | null;
  imageV: number | null;
  /** pieces: what can still be sold, what is sold and waiting to be collected, and the alert level */
  available: number;
  reserved: number;
  total: number;
  min: number | null;
  pack: Pack | null;
  baseSymbol: string;
  status: "ok" | "low" | "out";
  /** may add and remove stock by hand (inventory.adjust) / set a counted quantity (inventory.count) */
  canAdjust: boolean;
  canCount: boolean;
};

const BAR = { ok: "bg-emerald-500", low: "bg-oil-400", out: "bg-brand-red" } as const;
const BADGE = { ok: "badge-green", low: "badge-yellow", out: "badge-red" } as const;
const WORD = { ok: "In stock", low: "Low", out: "Out" } as const;

/**
 * One product in the warehouse, small: picture, name, what is available, a thin level bar, and Add / Remove / Count.
 * Cartons first with the loose pieces after them ("5 CTN + 2 PCS"); the small CTN | PCS switch changes only this product.
 */
export default function WarehouseStockCard(p: WarehouseStockCardProps) {
  const [mode, setMode] = useState<UnitMode>("ctn");
  const f = (n: number) => qtyText(n, p.pack, p.baseSymbol, mode).main;
  const pct = p.min && p.min > 0 ? Math.min(100, (p.available / (3 * p.min)) * 100) : null;
  return (
    <div className="card flex h-full flex-col p-3.5">
      <div className="flex items-start gap-3">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-50">
          {p.imageV ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/product-image/${p.id}?size=thumb&v=${p.imageV}`} alt="" loading="lazy" className="h-full w-full object-contain" />
          ) : (
            <Package size={22} className="text-slate-300" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500">{p.brand ? `${p.brand} · ${p.category}` : p.category}</p>
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-slate-900">{p.name}</h3>
          <p className="truncate font-mono text-[11px] text-slate-400">{p.sku}</p>
        </div>
        <span className={cn("shrink-0", BADGE[p.status])}>{WORD[p.status]}</span>
      </div>

      <div className="mt-3 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Available</p>
          <p className="truncate text-xl font-bold leading-tight tracking-tight text-slate-900">{f(p.available)}</p>
          {p.pack && <p className="text-[11px] text-slate-500">{packNote(p.pack, p.baseSymbol)}</p>}
        </div>
        {p.pack && <QtySwitch mode={mode} onChange={setMode} />}
      </div>

      {pct !== null ? (
        <div className="mt-2.5">
          <div className="relative h-1.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`Level against a minimum of ${f(p.min!)}`}>
            <div className={cn("h-full rounded-full", BAR[p.status])} style={{ width: `${Math.max(p.status === "out" ? 0 : 4, pct)}%` }} />
            <span className="absolute inset-y-0 left-1/3 w-px bg-slate-400/70" />
          </div>
          <p className="mt-1 text-[11px] text-slate-500">Minimum {f(p.min!)}</p>
        </div>
      ) : (
        <p className="mt-2.5 text-[11px] text-slate-400">No minimum set</p>
      )}
      {p.reserved > 0 && <p className="mt-1 text-[11px] text-slate-500">{f(p.reserved)} sold, waiting to be collected</p>}

      {(p.canAdjust || p.canCount) && (
        <div className="mt-auto pt-3">
          <div className="border-t border-line pt-3">
            <StockChangeButtons productId={p.id} name={p.name} sku={p.sku} imageV={p.imageV} pack={p.pack} baseSymbol={p.baseSymbol} total={p.total} reserved={p.reserved} canCount={p.canCount} compact allowChange={p.canAdjust} />
          </div>
        </div>
      )}
    </div>
  );
}
