"use client";

import { Trash2 } from "lucide-react";
import { defaultUnitId, type EditorLine, type PickerProduct } from "@/lib/inventory/types";
import ProductPicker from "./ProductPicker";

type Props = {
  products: PickerProduct[];
  lines: EditorLine[];
  onChange: (lines: EditorLine[]) => void;
  /** show the "total cost" box (receiving, for people allowed to enter costs) */
  showCost?: boolean;
  quantityLabel?: string;
  /** product id → quantity on hand (base units) at the location the user chose */
  onHand?: Record<string, string>;
  /** server errors keyed "line.<index>" */
  errors?: Record<string, string>;
  currencySymbol?: string;
  /** replaces the "Total cost" caption of the extra box (e.g. a price field on a reseller report) */
  costLabel?: string;
  disabled?: boolean;
};

const trim = (n: number) => String(Number(n.toFixed(3)));

export default function StockLinesEditor({ products, lines, onChange, showCost, quantityLabel = "Quantity", onHand, errors = {}, currencySymbol = "", costLabel, disabled }: Props) {
  const byId = new Map(products.map((p) => [p.id, p]));

  const add = (p: PickerProduct) => {
    if (lines.some((l) => l.productId === p.id)) return; // one line per product
    onChange([...lines, { productId: p.id, unitId: defaultUnitId(p, "purchase"), quantity: "", totalCost: "" }]);
  };
  const update = (i: number, patch: Partial<EditorLine>) => onChange(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  return (
    <div>
      {!disabled && <ProductPicker products={products.filter((p) => !lines.some((l) => l.productId === p.id))} onPick={add} />}

      {lines.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
          Search for a product above to add it. {errors.lines && <span className="font-medium text-brand-red-dark">{errors.lines}</span>}
        </p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {lines.map((l, i) => {
            const p = byId.get(l.productId);
            const unit = p?.units.find((u) => u.id === l.unitId) ?? p?.units[0];
            const base = p?.units[0];
            const qtyNum = Number(l.quantity);
            const baseQty = unit && Number.isFinite(qtyNum) && l.quantity.trim() !== "" ? qtyNum * Number(unit.factor) : null;
            const here = p && onHand ? Number(onHand[p.id] ?? 0) : null;
            const err = errors[`line.${i}`];
            return (
              <li key={l.productId} className={`rounded-lg border p-3 ${err ? "border-brand-red bg-brand-red-soft/40" : "border-line bg-slate-50/60"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{p?.name ?? "Unknown product"}</p>
                    <p className="text-xs text-slate-500">
                      {p?.sku}
                      {here !== null && base && <span className="ml-2 font-medium text-slate-600">On hand: {trim(here)} {base.symbol}</span>}
                    </p>
                  </div>
                  {!disabled && (
                    <button type="button" className="btn-secondary btn-sm shrink-0" onClick={() => onChange(lines.filter((_, idx) => idx !== i))} aria-label={`Remove ${p?.name}`}>
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>

                <div className={`mt-2.5 grid gap-3 ${showCost ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                  <div>
                    <label className="label" htmlFor={`unit-${i}`}>
                      Unit
                    </label>
                    <select id={`unit-${i}`} className="input" value={l.unitId} disabled={disabled} onChange={(e) => update(i, { unitId: e.target.value })}>
                      {p?.units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} {u.id === p.baseUnitId ? "" : `(= ${trim(Number(u.factor))} ${base?.symbol})`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor={`qty-${i}`}>
                      {quantityLabel}
                    </label>
                    <input
                      id={`qty-${i}`}
                      className="input"
                      inputMode="decimal"
                      value={l.quantity}
                      disabled={disabled}
                      onChange={(e) => update(i, { quantity: e.target.value })}
                      placeholder="0"
                    />
                  </div>
                  {showCost && (
                    <div>
                      <label className="label" htmlFor={`cost-${i}`}>
                        {costLabel ?? `Total cost${currencySymbol ? ` (${currencySymbol})` : ""}`}
                      </label>
                      <input id={`cost-${i}`} className="input" inputMode="decimal" value={l.totalCost} disabled={disabled} onChange={(e) => update(i, { totalCost: e.target.value })} placeholder="0" />
                    </div>
                  )}
                </div>
                {baseQty !== null && unit && base && unit.id !== base.id && (
                  <p className="hint">
                    = {trim(baseQty)} {base.symbol} in stock
                  </p>
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
