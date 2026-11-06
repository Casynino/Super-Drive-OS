"use client";

import Link from "next/link";
import { useState } from "react";
import { Package } from "lucide-react";
import QtySwitch from "@/components/QtySwitch";
import { packNote, qtyText, type Pack, type UnitMode } from "@/lib/qty";
import { cn } from "@/lib/utils";

export type StockCardProps = {
  id: string;
  name: string;
  sku: string;
  category: string;
  brand: string | null;
  imageV: number | null;
  /** quantities in the base unit (pieces); the card writes them as cartons or pieces */
  qtyBase: number;
  minBase: number | null;
  awayBase: number | null;
  /** sold and waiting to be collected from the warehouse (still physically here); shown under the level bar */
  reservedBase?: number | null;
  /** the heading above the big number: "On the shelf" by default */
  label?: string;
  pack: Pack | null;
  baseSymbol: string;
  /** 0-100: how full the shelf is against 3x the minimum (the minimum sits at one third); null when no minimum is set */
  levelPct: number | null;
  status: "ok" | "low" | "out";
  value: string | null;
  href: string | null;
};

const BAR = { ok: "bg-emerald-500", low: "bg-oil-400", out: "bg-brand-red" } as const;

/**
 * One product on the stock overview: picture, what is on the shelf, and a level bar against its minimum.
 * Cartons are the default; the small CTN | PCS switch changes only THIS product's numbers.
 */
export default function StockCard(p: StockCardProps) {
  const [mode, setMode] = useState<UnitMode>("ctn");
  const f = (n: number) => qtyText(n, p.pack, p.baseSymbol, mode).main;
  const min = p.minBase !== null ? f(p.minBase) : null;
  const body = (
    <div className={cn("card flex h-full flex-col overflow-hidden transition", p.href && "hover:-translate-y-0.5 hover:border-navy-200 hover:shadow-md")}>
      <div className="flex gap-4 p-4">
        <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-50">
          {p.imageV ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/product-image/${p.id}?size=thumb&v=${p.imageV}`} alt="" loading="lazy" className="h-full w-full object-contain" />
          ) : (
            <Package size={30} className="text-slate-300" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500">{p.brand ? `${p.brand} · ${p.category}` : p.category}</p>
          <h3 className="mt-0.5 line-clamp-2 text-[15px] font-semibold leading-snug text-slate-900">{p.name}</h3>
          <p className="mt-1 truncate font-mono text-xs text-slate-400">{p.sku}</p>
        </div>
      </div>

      <div className="mt-auto border-t border-line px-4 py-3">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{p.label ?? "On the shelf"}</p>
            <p className="mt-0.5 truncate text-2xl font-bold leading-none tracking-tight text-slate-900">{f(p.qtyBase)}</p>
            {p.pack && <p className="mt-1 text-xs text-slate-500">{packNote(p.pack, p.baseSymbol)}</p>}
          </div>
          <div className="flex flex-col items-end gap-1.5">
            {p.pack && <QtySwitch mode={mode} onChange={setMode} />}
            {p.status === "out" ? <span className="badge-red">Out of stock</span> : p.status === "low" ? <span className="badge-yellow">Low</span> : <span className="badge-green">In stock</span>}
          </div>
        </div>

        {p.levelPct !== null ? (
          <div className="mt-3">
            <div className="relative h-2 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`Stock level against a minimum of ${min}`}>
              <div className={cn("h-full rounded-full transition-all", BAR[p.status])} style={{ width: `${Math.max(p.status === "out" ? 0 : 4, p.levelPct)}%` }} />
              <span className="absolute inset-y-0 left-1/3 w-px bg-slate-400/70" />
            </div>
            <p className="mt-1 text-[11px] text-slate-500">Minimum {min}</p>
          </div>
        ) : (
          <p className="mt-3 text-[11px] text-slate-400">No minimum set, so no low-stock alert</p>
        )}

        {((p.awayBase ?? 0) > 0 || (p.reservedBase ?? 0) > 0 || p.value) && (
          <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500">
            <span>{(p.reservedBase ?? 0) > 0 ? `${f(p.reservedBase!)} reserved, waiting to be collected` : (p.awayBase ?? 0) > 0 ? `${f(p.awayBase!)} with winga` : ""}</span>
            {p.value && <span className="font-medium text-slate-700">{p.value}</span>}
          </div>
        )}
      </div>
    </div>
  );
  return p.href ? (
    <Link href={p.href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}
