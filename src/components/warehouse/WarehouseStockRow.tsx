"use client";

import { useState } from "react";
import { Package } from "lucide-react";
import QtySwitch from "@/components/QtySwitch";
import StockChangeButtons from "@/components/inventory/StockChangeButtons";
import { qtyText, type Pack, type UnitMode } from "@/lib/qty";
import { cn } from "@/lib/utils";
import { STOCK_ROW_GRID } from "./stock-grid";

export type WarehouseStockRowProps = {
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
 * One product in the warehouse as ONE short line: picture, name and code, what is available ("5 CTN + 2 PCS", with its own small CTN | PCS switch),
 * a thin level bar against the minimum, what is sold and waiting, the status, and Add / Remove / Count. Built to stay readable with many products.
 */
export default function WarehouseStockRow(p: WarehouseStockRowProps) {
  const [mode, setMode] = useState<UnitMode>("ctn");
  const f = (n: number) => qtyText(n, p.pack, p.baseSymbol, mode).main;
  const pct = p.min && p.min > 0 ? Math.min(100, (p.available / (3 * p.min)) * 100) : null;
  const level =
    pct !== null ? (
      <div className="min-w-0">
        <div className="relative h-1.5 w-full max-w-[10rem] overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`Level against a minimum of ${f(p.min!)}`}>
          <div className={cn("h-full rounded-full", BAR[p.status])} style={{ width: `${Math.max(p.status === "out" ? 0 : 4, pct)}%` }} />
          <span className="absolute inset-y-0 left-1/3 w-px bg-slate-400/70" />
        </div>
        <p className="mt-1 truncate text-[11px] text-slate-500">Minimum {f(p.min!)}</p>
      </div>
    ) : (
      <p className="text-[11px] text-slate-400">No minimum set</p>
    );
  return (
    <li className={cn("grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:px-4", STOCK_ROW_GRID)}>
      <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-slate-50">
        {p.imageV ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/product-image/${p.id}?size=thumb&v=${p.imageV}`} alt="" loading="lazy" className="h-full w-full object-contain" />
        ) : (
          <Package size={18} className="text-slate-300" />
        )}
      </span>
      <div className="min-w-0">
        <h3 className="truncate text-sm font-semibold text-slate-900">{p.name}</h3>
        <p className="truncate text-[11px] text-slate-500">
          {p.brand ? `${p.brand} · ` : ""}
          {p.category} · <span className="font-mono">{p.sku}</span>
        </p>
      </div>

      {/* phone: the status sits at the end of the first line; wide screens: it has its own column further right (order-6) */}
      <span className={cn("shrink-0 justify-self-end lg:order-6", BADGE[p.status])}>{WORD[p.status]}</span>

      <div className="col-span-2 lg:order-3 lg:col-span-1">
        <div className="flex items-center gap-2">
          <div className="min-w-0">
            <p className="truncate text-base font-bold leading-tight text-slate-900">{f(p.available)}</p>
            <p className="text-[11px] text-slate-500 lg:hidden">{p.reserved > 0 ? `${f(p.reserved)} sold, waiting` : "available"}</p>
          </div>
          {p.pack && <QtySwitch mode={mode} onChange={setMode} />}
        </div>
      </div>

      <div className="hidden lg:order-4 lg:block">{level}</div>
      <p className="hidden text-xs text-slate-500 lg:order-5 lg:block">{p.reserved > 0 ? `${f(p.reserved)} waiting` : "none"}</p>

      {(p.canAdjust || p.canCount) && (
        <div className="flex justify-end lg:order-7">
          <StockChangeButtons productId={p.id} name={p.name} sku={p.sku} imageV={p.imageV} pack={p.pack} baseSymbol={p.baseSymbol} total={p.total} reserved={p.reserved} canCount={p.canCount} compact allowChange={p.canAdjust} />
        </div>
      )}
    </li>
  );
}
