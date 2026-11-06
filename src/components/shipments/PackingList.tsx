"use client";

import { ImageOff, PackageOpen, Trash2 } from "lucide-react";
import type { PickerProduct } from "@/lib/inventory/types";
import { cn } from "@/lib/utils";
import { lineFigures, type ShipmentLine } from "./ShipmentLinesEditor";

const money = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(n));
const trim = (n: number) => String(Number(n.toFixed(3)));

export type PackingTotals = { products: number; pieces: number; cost: number; sales: number; profit: number; margin: number };

export function packingTotals(lines: ShipmentLine[], products: PickerProduct[]): PackingTotals {
  const byId = new Map(products.map((p) => [p.id, p]));
  let cost = 0;
  let sales = 0;
  let pieces = 0;
  let priced = 0;
  for (const l of lines) {
    const f = lineFigures(l, byId.get(l.productId));
    if (Number.isFinite(f.total)) cost += f.total;
    if (Number.isFinite(f.baseQty)) pieces += f.baseQty;
    if (Number.isFinite(f.salesValue) && Number.isFinite(f.total)) {
      sales += f.salesValue;
      priced += f.total;
    }
  }
  // profit counts only the lines that have both a buying and a selling price
  return { products: lines.length, pieces, cost, sales, profit: sales - priced, margin: sales > 0 ? ((sales - priced) / sales) * 100 : NaN };
}

/**
 * The packing list of the batch: every product with how many, as it will be sealed.
 * `compact` is the side panel while adding; the full version (with prices and margin) is the review step.
 */
export default function PackingList({
  lines,
  products,
  canPrice,
  currencySymbol,
  compact = false,
  onRemove,
  headerAction,
  className,
}: {
  lines: ShipmentLine[];
  products: PickerProduct[];
  canPrice: boolean;
  currencySymbol: string;
  compact?: boolean;
  onRemove?: (productId: string) => void;
  /** a button shown in the header (the review step uses it for "Edit packing list") */
  headerAction?: React.ReactNode;
  className?: string;
}) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const t = packingTotals(lines, products);

  return (
    <section className={cn("card overflow-hidden", className)} aria-label="Packing list">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <PackageOpen size={18} className="text-navy-700" /> Packing list
        </h2>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-navy-50 px-2.5 py-0.5 text-xs font-semibold text-navy-800">
            {t.products} product{t.products === 1 ? "" : "s"} · {trim(t.pieces)} pieces
          </span>
          {headerAction}
        </div>
      </div>

      {lines.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-slate-500">Nothing in the batch yet. Add products and they appear here, like a packing list.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {lines.map((l, i) => {
            const p = byId.get(l.productId);
            const f = lineFigures(l, p);
            const base = p?.units[0];
            const ok = Number.isFinite(f.baseQty) && Number.isFinite(f.total) && f.total > 0;
            return (
              <li key={l.productId} className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-5 shrink-0 text-center text-xs font-semibold text-slate-400">{i + 1}</span>
                <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-white">
                  {p?.imageV ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/product-image/${l.productId}?size=thumb&v=${p.imageV}`} alt="" className="h-full w-full object-contain" />
                  ) : (
                    <ImageOff size={16} className="text-slate-300" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">{p?.name ?? "Unknown product"}</p>
                  <p className="text-xs text-slate-500">
                    {Number.isFinite(f.baseQty) ? (
                      <>
                        <span className="font-semibold text-slate-700">
                          {trim(Number(l.quantity))} {f.unit?.symbol}
                        </span>
                        {f.unit && base && f.unit.id !== base.id && <> · {trim(f.baseQty)} {base.symbol}</>}
                      </>
                    ) : (
                      <span className="text-brand-red-dark">How many?</span>
                    )}
                    {!compact && ok && canPrice && Number.isFinite(f.margin) && <span className={cn("ml-2 font-semibold", f.margin < 0 ? "text-brand-red-dark" : f.margin < 15 ? "text-yellow-700" : "text-emerald-700")}>{Math.round(f.margin)}% margin</span>}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold text-slate-900">{Number.isFinite(f.total) ? `${currencySymbol} ${money(f.total)}` : "—"}</p>
                  {!compact && canPrice && Number.isFinite(f.sell) && <p className="text-xs text-slate-500">sells {currencySymbol} {money(f.sell)} each</p>}
                </div>
                {onRemove && (
                  <button type="button" className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-red-dark" onClick={() => onRemove(l.productId)} aria-label={`Remove ${p?.name}`}>
                    <Trash2 size={15} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <dl className="space-y-1.5 border-t border-line bg-slate-50/60 px-4 py-3 text-sm">
        <div className="flex justify-between">
          <dt className="text-slate-600">You pay</dt>
          <dd className="font-bold text-slate-900">
            {currencySymbol} {money(t.cost)}
          </dd>
        </div>
        {canPrice && t.sales > 0 && (
          <>
            <div className="flex justify-between">
              <dt className="text-slate-600">Sells for</dt>
              <dd className="font-semibold text-slate-900">
                {currencySymbol} {money(t.sales)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-600">{t.profit >= 0 ? "Expected profit" : "Expected loss"}</dt>
              <dd className={cn("font-bold", t.profit >= 0 ? "text-emerald-700" : "text-brand-red-dark")}>
                {currencySymbol} {money(Math.abs(t.profit))}
                {Number.isFinite(t.margin) && ` (${Math.round(t.margin)}%)`}
              </dd>
            </div>
          </>
        )}
      </dl>
    </section>
  );
}
