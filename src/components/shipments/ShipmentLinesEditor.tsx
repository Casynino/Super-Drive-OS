"use client";

import { ImageOff, Trash2 } from "lucide-react";
import ProductPicker from "@/components/inventory/ProductPicker";
import { defaultUnitId, type PickerProduct } from "@/lib/inventory/types";
import { cn } from "@/lib/utils";

/** One product on the shipment. Buying price can be typed per piece or as a line total; the other is worked out. */
export type ShipmentLine = {
  productId: string;
  unitId: string;
  quantity: string;
  costPerPiece: string;
  totalCost: string;
  /** which of the two buying-price boxes the owner typed last; the other follows it */
  anchor: "unit" | "total";
  sellingPrice: string;
  wholesalePrice: string;
};

export const newLine = (p: PickerProduct, unitId?: string): ShipmentLine => ({
  productId: p.id,
  unitId: unitId ?? p.baseUnitId,
  quantity: "",
  costPerPiece: "",
  totalCost: "",
  anchor: "unit",
  sellingPrice: p.sellingPrice && Number(p.sellingPrice) > 0 ? String(Number(p.sellingPrice)) : "",
  wholesalePrice: p.wholesalePrice && Number(p.wholesalePrice) > 0 ? String(Number(p.wholesalePrice)) : "",
});

const num = (s: string) => (s.trim() === "" ? NaN : Number(s.replace(/,/g, "")));
const money = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(n));
const trim = (n: number, dp = 2) => String(Number(n.toFixed(dp)));

/** Numbers for one line, shared by the editor and the totals bar. */
export function lineFigures(l: ShipmentLine, p: PickerProduct | undefined) {
  const unit = p?.units.find((u) => u.id === l.unitId) ?? p?.units[0];
  const qty = num(l.quantity);
  const baseQty = unit && Number.isFinite(qty) && qty > 0 ? qty * Number(unit.factor) : NaN;
  const total = num(l.totalCost);
  const cpp = Number.isFinite(baseQty) && Number.isFinite(total) ? total / baseQty : NaN;
  const sell = num(l.sellingPrice);
  const profitEach = Number.isFinite(cpp) && Number.isFinite(sell) ? sell - cpp : NaN;
  const margin = Number.isFinite(profitEach) && sell > 0 ? (profitEach / sell) * 100 : NaN;
  const lineProfit = Number.isFinite(profitEach) && Number.isFinite(baseQty) ? profitEach * baseQty : NaN;
  const salesValue = Number.isFinite(sell) && Number.isFinite(baseQty) ? sell * baseQty : NaN;
  return { unit, baseQty, total, cpp, sell, profitEach, margin, lineProfit, salesValue };
}

type Props = {
  products: PickerProduct[];
  lines: ShipmentLine[];
  onChange: (lines: ShipmentLine[]) => void;
  canPrice: boolean;
  currencySymbol: string;
  errors?: Record<string, string>;
};

export default function ShipmentLinesEditor({ products, lines, onChange, canPrice, currencySymbol, errors = {} }: Props) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const add = (p: PickerProduct) => {
    if (lines.some((l) => l.productId === p.id)) return;
    onChange([...lines, newLine(p, defaultUnitId(p, "purchase"))]); // cartons first
  };
  const update = (i: number, patch: Partial<ShipmentLine>) => onChange(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  /** Re-works the following box after quantity, unit or a price changed, so per-piece and total always agree. */
  const withCost = (l: ShipmentLine, patch: Partial<ShipmentLine>): ShipmentLine => {
    const next = { ...l, ...patch };
    const f = lineFigures(next, byId.get(next.productId));
    if (next.anchor === "unit") {
      const c = num(next.costPerPiece);
      next.totalCost = Number.isFinite(c) && Number.isFinite(f.baseQty) ? String(Math.round(c * f.baseQty)) : next.totalCost;
    } else {
      const t = num(next.totalCost);
      next.costPerPiece = Number.isFinite(t) && Number.isFinite(f.baseQty) ? trim(t / f.baseQty) : next.costPerPiece;
    }
    return next;
  };
  const edit = (i: number, patch: Partial<ShipmentLine>) => onChange(lines.map((l, idx) => (idx === i ? withCost(l, patch) : l)));

  return (
    <div>
      <ProductPicker products={products.filter((p) => !lines.some((l) => l.productId === p.id))} onPick={add} placeholder="Search a product you bought…" />

      {lines.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
          Search for a product above to add it, or press <strong>New product</strong> if it is not in the system yet.
          {errors.lines && <span className="mt-1 block font-medium text-brand-red-dark">{errors.lines}</span>}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {lines.map((l, i) => {
            const p = byId.get(l.productId);
            const f = lineFigures(l, p);
            const base = p?.units[0];
            const err = errors[`line.${i}`];
            const tone = Number.isNaN(f.margin) ? "" : f.margin < 0 ? "red" : f.margin < 15 ? "yellow" : "green";
            return (
              <li key={l.productId} className={cn("rounded-xl border p-4", err ? "border-brand-red bg-brand-red-soft/40" : "border-line bg-slate-50/60")}>
                <div className="flex items-start gap-3">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-white">
                    {p?.imageV ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/product-image/${l.productId}?size=thumb&v=${p.imageV}`} alt="" className="h-full w-full object-contain" />
                    ) : (
                      <ImageOff size={18} className="text-slate-300" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-slate-900">{p?.name ?? "Unknown product"}</p>
                    <p className="text-xs text-slate-500">{p?.sku}</p>
                  </div>
                  <button type="button" className="btn-secondary btn-sm shrink-0" onClick={() => onChange(lines.filter((_, idx) => idx !== i))} aria-label={`Remove ${p?.name}`}>
                    <Trash2 size={15} />
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <div>
                    <label className="label" htmlFor={`unit-${i}`}>
                      Bought in
                    </label>
                    <select id={`unit-${i}`} className="input" value={l.unitId} onChange={(e) => edit(i, { unitId: e.target.value })}>
                      {p?.units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                          {u.id === p.baseUnitId ? "" : ` (${trim(Number(u.factor), 3)} ${base?.symbol})`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor={`qty-${i}`}>
                      How many
                    </label>
                    <input id={`qty-${i}`} className="input text-base font-semibold" inputMode="decimal" placeholder="0" value={l.quantity} onChange={(e) => edit(i, { quantity: e.target.value })} />
                  </div>
                  <div>
                    <label className="label" htmlFor={`cpp-${i}`}>
                      Buying price per piece ({currencySymbol})
                    </label>
                    <input id={`cpp-${i}`} className="input" inputMode="decimal" placeholder="0" value={l.costPerPiece} onChange={(e) => edit(i, { costPerPiece: e.target.value, anchor: "unit" })} />
                  </div>
                  <div>
                    <label className="label" htmlFor={`tot-${i}`}>
                      Total for this line ({currencySymbol})
                    </label>
                    <input id={`tot-${i}`} className="input" inputMode="decimal" placeholder="0" value={l.totalCost} onChange={(e) => edit(i, { totalCost: e.target.value, anchor: "total" })} />
                  </div>
                </div>
                {f.unit && base && f.unit.id !== base.id && Number.isFinite(f.baseQty) && (
                  <p className="hint">
                    = {trim(f.baseQty, 3)} {base.symbol} in stock
                  </p>
                )}

                {canPrice && (
                  <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <div>
                      <label className="label" htmlFor={`sell-${i}`}>
                        Selling price per piece ({currencySymbol})
                      </label>
                      <input id={`sell-${i}`} className="input" inputMode="decimal" placeholder="Keep current" value={l.sellingPrice} onChange={(e) => update(i, { sellingPrice: e.target.value })} />
                    </div>
                    <div>
                      <label className="label" htmlFor={`whole-${i}`}>
                        Wholesale price <span className="font-normal text-slate-400">(optional)</span>
                      </label>
                      <input id={`whole-${i}`} className="input" inputMode="decimal" placeholder="Keep current" value={l.wholesalePrice} onChange={(e) => update(i, { wholesalePrice: e.target.value })} />
                    </div>
                    <div className="col-span-2 flex items-end">
                      {tone ? (
                        <p
                          className={cn(
                            "w-full rounded-lg px-3 py-2 text-sm",
                            tone === "green" && "bg-emerald-50 text-emerald-800",
                            tone === "yellow" && "bg-oil-soft text-yellow-800",
                            tone === "red" && "bg-brand-red-soft text-brand-red-dark",
                          )}
                        >
                          <span className="font-semibold">
                            {f.profitEach >= 0 ? "Profit" : "Loss"} {currencySymbol} {money(Math.abs(f.profitEach))} per piece · {Math.round(f.margin)}%
                          </span>
                          {Number.isFinite(f.lineProfit) && (
                            <span className="block text-xs opacity-80">
                              {currencySymbol} {money(f.lineProfit)} on this line if it all sells
                            </span>
                          )}
                        </p>
                      ) : (
                        <p className="w-full rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500">Fill in the buying and selling price and your profit shows here.</p>
                      )}
                    </div>
                  </div>
                )}
                {err && <p className="field-error">{err}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
