"use client";

import Link from "next/link";
import { useState } from "react";
import { Package } from "lucide-react";
import QtySwitch from "@/components/QtySwitch";
import StockChangeButtons from "@/components/inventory/StockChangeButtons";
import { qtyText, type Pack, type UnitMode } from "@/lib/qty";
import { cn } from "@/lib/utils";

export type WarehouseStockCardProps = {
  id: string;
  name: string;
  sku: string;
  category: string;
  brand: string | null;
  imageV: number | null;
  /** pieces: what can still be sold, what is sold and waiting to be collected, and in all */
  available: number;
  reserved: number;
  total: number;
  min: number | null;
  pack: Pack | null;
  baseSymbol: string;
  status: "ok" | "low" | "out";
  /** may add and remove stock by hand (inventory.adjust) / set a counted quantity */
  canAdjust: boolean;
  canCount: boolean;
};

const BAR = { ok: "bg-emerald-500", low: "bg-oil-400", out: "bg-brand-red" } as const;
const BADGE = { ok: "badge-green", low: "badge-yellow", out: "badge-red" } as const;
const WORD = { ok: "In stock", low: "Low", out: "Out" } as const;

/**
 * One product in the warehouse as a SMALL card (Nino 2026-11-08: "small, nice, we may have more products"): a 44 px picture, the name, what is available
 * ("5 CTN + 2 PCS", with its own tiny CTN | PCS switch), the status, a thin level bar with the minimum and what is waiting, and Add / Remove / Count.
 * About 5 across on a computer, 2 on a phone.
 */
export default function WarehouseStockCard(p: WarehouseStockCardProps) {
  const [mode, setMode] = useState<UnitMode>("ctn");
  const f = (n: number) => qtyText(n, p.pack, p.baseSymbol, mode).main;
  const pct = p.min && p.min > 0 ? Math.min(100, (p.available / (3 * p.min)) * 100) : null;
  return (
    <div className="card relative flex h-full flex-col p-3 transition hover:border-navy-200 hover:shadow-md">
      <div className="flex items-start gap-2.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-50">
          {p.imageV ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/product-image/${p.id}?size=thumb&v=${p.imageV}`} alt="" loading="lazy" className="h-full w-full object-contain" />
          ) : (
            <Package size={18} className="text-slate-300" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-[13px] font-semibold leading-snug text-slate-900">
            {/* the whole card opens the product's stock (the name link stretches over it); the switch and the buttons stay above it */}
            <Link href={`/warehouse/stock/${p.id}`} className="after:absolute after:inset-0 after:content-[''] hover:text-navy-700">
              {p.name}
            </Link>
          </h3>
          <p className="truncate text-[10px] text-slate-500">{p.brand ?? p.category}</p>
        </div>
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-1">
        <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Available</p>
        {p.pack && (
          <span className="relative z-10">
            <QtySwitch mode={mode} onChange={setMode} />
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-lg font-bold leading-tight tracking-tight text-slate-900">{f(p.available)}</p>
        <span className={cn("shrink-0", BADGE[p.status])}>{WORD[p.status]}</span>
      </div>

      <div className="mt-1.5">
        {pct !== null && (
          <div className="relative h-1 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`Level against a minimum of ${f(p.min!)}`}>
            <div className={cn("h-full rounded-full", BAR[p.status])} style={{ width: `${Math.max(p.status === "out" ? 0 : 6, pct)}%` }} />
            <span className="absolute inset-y-0 left-1/3 w-px bg-slate-400/70" />
          </div>
        )}
        <p className="mt-1 truncate text-[10px] text-slate-500">
          {p.min ? `Min ${f(p.min)}` : "No minimum"}
          {p.reserved > 0 ? ` · ${f(p.reserved)} waiting` : ""}
        </p>
      </div>

      {(p.canAdjust || p.canCount) && (
        <div className="relative z-10 mt-auto pt-2.5">
          <StockChangeButtons productId={p.id} name={p.name} sku={p.sku} imageV={p.imageV} pack={p.pack} baseSymbol={p.baseSymbol} total={p.total} reserved={p.reserved} canCount={p.canCount} compact allowChange={p.canAdjust} />
        </div>
      )}
    </div>
  );
}
