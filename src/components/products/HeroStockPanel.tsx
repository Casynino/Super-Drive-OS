"use client";

import { useState } from "react";
import QtySwitch from "@/components/QtySwitch";
import { qtyText, type Pack, type UnitMode } from "@/lib/qty";

export type HeroStock = { available: number; reseller: number; sold: number; returned: number; damaged: number; missing: number };

/**
 * Where this product's stock is (shop, resellers, sold, returned, damaged) with one bar for the split.
 * Cartons by default; the CTN | PCS switch here changes only this product's numbers.
 */
export default function HeroStockPanel({ stock, pack, baseSymbol, minStock }: { stock: HeroStock; pack: Pack | null; baseSymbol: string; minStock: number }) {
  const [mode, setMode] = useState<UnitMode>("ctn");
  const f = (n: number) => qtyText(n, pack, baseSymbol, mode).main;
  const total = stock.available + stock.reseller + stock.sold + stock.damaged;
  const out = stock.available === 0;
  const low = !out && minStock > 0 && stock.available <= minStock;
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  const tiles = [
    { k: "In the shop", v: stock.available, tone: out ? "text-brand-red-dark" : low ? "text-yellow-700" : "text-emerald-700" },
    { k: "With resellers", v: stock.reseller, tone: "text-blue-700" },
    { k: "Sold", v: stock.sold, tone: "text-slate-900" },
    { k: "Returned", v: stock.returned, tone: "text-slate-900" },
    { k: "Damaged", v: stock.damaged, tone: stock.damaged > 0 ? "text-brand-red-dark" : "text-slate-900" },
  ];
  const segments = [
    { n: stock.available, cls: out ? "bg-brand-red" : low ? "bg-oil-400" : "bg-emerald-500", label: "in the shop" },
    { n: stock.reseller, cls: "bg-blue-500", label: "with resellers" },
    { n: stock.damaged, cls: "bg-brand-red", label: "damaged" },
    { n: stock.sold, cls: "bg-slate-300", label: "sold" },
  ];
  return (
    <div className="border-t border-line px-5 pb-5 pt-4">
      {pack && (
        <div className="mb-3 flex items-center justify-end gap-2 text-xs text-slate-500">
          Show this product in
          <QtySwitch mode={mode} onChange={setMode} />
        </div>
      )}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.k}>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{t.k}</dt>
            <dd className={`mt-0.5 text-2xl font-bold leading-tight ${t.tone}`}>{f(t.v)}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={segments.filter((s) => s.n > 0).map((s) => `${s.n} ${s.label}`).join(", ")}>
        {segments.map((s) => (s.n > 0 ? <span key={s.label} className={s.cls} style={{ width: `${pct(s.n)}%` }} title={`${s.n} ${s.label}`} /> : null))}
      </div>
      <p className="mt-1.5 flex flex-wrap justify-between gap-2 text-xs text-slate-500">
        <span>
          {f(total)} in all{minStock > 0 && <> · reorder when {f(minStock)} or less is left</>}
        </span>
        {stock.missing > 0 && <span className="text-yellow-700">{f(stock.missing)} marked missing</span>}
      </p>
    </div>
  );
}
