"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight, Package } from "lucide-react";
import QtySwitch from "@/components/QtySwitch";
import { qtyText, type Pack, type UnitMode } from "@/lib/qty";
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
const BADGE = { ok: "badge-green", low: "badge-yellow", out: "badge-red" } as const;
const WORD = { ok: "In stock", low: "Low", out: "Out" } as const;

/**
 * One product on the stock overview as a SMALL card, the same size and look as the warehouse stock cards (Nino 2026-11-09: "small cards like those,
 * nice and well"): a 44 px picture, name, brand, what is on the shelf ("5 CTN + 2 PCS", with its own tiny CTN | PCS switch), the status, a thin level
 * bar with the minimum, and the stock value when the person may see it. The whole card opens the product's stock page. About 6 across on a wide
 * screen, 2 on a phone.
 */
export default function StockCard(p: StockCardProps) {
  const [mode, setMode] = useState<UnitMode>("ctn");
  const f = (n: number) => qtyText(n, p.pack, p.baseSymbol, mode).main;
  const min = p.minBase !== null ? f(p.minBase) : null;
  const note = [min ? `Min ${min}` : "No minimum", (p.reservedBase ?? 0) > 0 ? `${f(p.reservedBase!)} waiting` : null, (p.awayBase ?? 0) > 0 ? `${f(p.awayBase!)} with winga` : null].filter(Boolean).join(" · ");
  return (
    <div className={cn("card group relative flex h-full flex-col p-3 transition", p.href && "cursor-pointer hover:border-navy-300")}>
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
            {p.href ? (
              // the whole card opens the product (the name link stretches over it); the CTN | PCS switch stays above it
              <Link href={p.href} className="after:absolute after:inset-0 after:content-[''] group-hover:text-navy-700" aria-label={`Open ${p.name}`}>
                {p.name}
              </Link>
            ) : (
              p.name
            )}
          </h3>
          <p className="truncate text-[10px] text-slate-500">{p.brand ?? p.category}</p>
        </div>
        {p.href && (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition group-hover:bg-navy-700 group-hover:text-[#ffffff]" aria-hidden>
            <ChevronRight size={14} />
          </span>
        )}
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-1">
        <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{p.label ?? "On the shelf"}</p>
        {p.pack && (
          <span className="relative z-10">
            <QtySwitch mode={mode} onChange={setMode} />
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-lg font-semibold leading-tight tracking-tight text-slate-900">{f(p.qtyBase)}</p>
        <span className={cn("shrink-0", BADGE[p.status])}>{WORD[p.status]}</span>
      </div>

      <div className="mt-1.5">
        {p.levelPct !== null && (
          <div className="relative h-1 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`Stock level against a minimum of ${min}`}>
            <div className={cn("h-full rounded-full", BAR[p.status])} style={{ width: `${Math.max(p.status === "out" ? 0 : 6, p.levelPct)}%` }} />
            <span className="absolute inset-y-0 left-1/3 w-px bg-slate-400/70" />
          </div>
        )}
        <p className="mt-1 truncate text-[10px] text-slate-500">{note}</p>
      </div>

      {p.value && <p className="mt-auto pt-1.5 text-right text-[11px] font-semibold tabular-nums text-slate-700">{p.value}</p>}
    </div>
  );
}
