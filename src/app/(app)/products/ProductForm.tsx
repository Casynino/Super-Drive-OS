"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Trash2 } from "lucide-react";
import { Alert } from "@/components/ui";
import { Field, SubmitButton, inputClass } from "@/components/FormBits";
import type { ActionState } from "@/lib/action";
import { saveProduct } from "./actions";

type Option = { id: string; name: string };
type UnitOption = { id: string; name: string; symbol: string; allowsDecimal: boolean };
type UnitRow = { unitId: string; factor: string; sellingPrice: string; wholesalePrice: string };

export type ProductFormData = {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  categoryId: string;
  brandId: string;
  packagingType: string;
  description: string;
  baseUnitId: string;
  purchasePrice: string;
  sellingPrice: string;
  wholesalePrice: string;
  minStock: string;
  units: UnitRow[];
};

type Props = {
  product?: ProductFormData;
  categories: Option[];
  brands: Option[];
  units: UnitOption[];
  currencySymbol: string;
  canPrice: boolean;
  canCost: boolean;
  readOnly?: boolean;
};

const initial: ActionState = {};

export default function ProductForm({ product, categories, brands, units, currencySymbol, canPrice, canCost, readOnly }: Props) {
  const [state, action] = useActionState(saveProduct, initial);
  const fe = state.fieldErrors ?? {};
  const v = (name: keyof ProductFormData): string => state.values?.[name] ?? (product?.[name] as string | undefined) ?? "";

  const [baseUnitId, setBaseUnitId] = useState(v("baseUnitId"));
  const [rows, setRows] = useState<UnitRow[]>(() => {
    try {
      if (state.values?.unitsJson) return JSON.parse(state.values.unitsJson) as UnitRow[];
    } catch {}
    return product?.units ?? [];
  });

  const isEdit = Boolean(product);
  const baseUnit = units.find((u) => u.id === baseUnitId);
  const disabled = readOnly;
  const usedIds = new Set([baseUnitId, ...rows.map((r) => r.unitId)]);
  const addable = units.filter((u) => !usedIds.has(u.id));

  const updateRow = (i: number, patch: Partial<UnitRow>) => setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  return (
    <form action={action} className="space-y-5" noValidate>
      {product && <input type="hidden" name="id" value={product.id} />}
      <input type="hidden" name="unitsJson" value={JSON.stringify(rows)} />

      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && state.message && <Alert kind="success">{state.message}</Alert>}

      <section className="card card-pad">
        <h2 className="mb-4 text-base font-semibold text-slate-900">Basic information</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Product name" name="name" error={fe.name} required className="md:col-span-2">
            <input id="name" name="name" defaultValue={v("name")} disabled={disabled} className={inputClass(fe.name)} placeholder="e.g. Castrol GTX 20W-50 5L" />
          </Field>
          <Field label="SKU / product code" name="sku" error={fe.sku} required hint="Unique. Letters and numbers, e.g. CAS-GTX-5L.">
            <input id="sku" name="sku" defaultValue={v("sku")} disabled={disabled} className={inputClass(fe.sku)} autoCapitalize="characters" />
          </Field>
          <Field label="Barcode" name="barcode" error={fe.barcode} hint="Optional. Scan or type it.">
            <input id="barcode" name="barcode" defaultValue={v("barcode")} disabled={disabled} className={inputClass(fe.barcode)} inputMode="numeric" />
          </Field>
          <Field label="Category" name="categoryId" error={fe.categoryId} required>
            <select id="categoryId" name="categoryId" defaultValue={v("categoryId")} disabled={disabled} className={inputClass(fe.categoryId)}>
              <option value="">Choose category…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Brand" name="brandId" error={fe.brandId}>
            <select id="brandId" name="brandId" defaultValue={v("brandId")} disabled={disabled} className={inputClass(fe.brandId)}>
              <option value="">No brand</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Packaging type" name="packagingType" error={fe.packagingType} hint="e.g. Jerrycan, Bottle, Drum, Pail.">
            <input id="packagingType" name="packagingType" defaultValue={v("packagingType")} disabled={disabled} className={inputClass(fe.packagingType)} />
          </Field>
          <Field label="Description" name="description" error={fe.description} className="md:col-span-2">
            <textarea id="description" name="description" rows={2} defaultValue={v("description")} disabled={disabled} className={inputClass(fe.description)} />
          </Field>
        </div>
      </section>

      <section className="card card-pad">
        <h2 className="text-base font-semibold text-slate-900">Units &amp; packaging</h2>
        <p className="mb-4 mt-1 text-sm text-slate-500">
          Stock is always counted in the base unit. If you sell bigger packs (cartons, drums), add them below so stock is deducted correctly.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Base unit"
            name="baseUnitId"
            error={fe.baseUnitId}
            required
            hint={isEdit ? "The base unit cannot be changed after the product is created." : "The smallest unit you count and sell, e.g. Bottle or Litre."}
          >
            <select
              id="baseUnitId"
              name="baseUnitId"
              value={baseUnitId}
              onChange={(e) => setBaseUnitId(e.target.value)}
              disabled={disabled || isEdit}
              className={inputClass(fe.baseUnitId)}
            >
              <option value="">Choose unit…</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.symbol})
                </option>
              ))}
            </select>
            {isEdit && <input type="hidden" name="baseUnitId" value={baseUnitId} />}
          </Field>
        </div>

        <div className="mt-5">
          <p className="label">Other packaging units</p>
          {rows.length === 0 && <p className="text-sm text-slate-500">None. This product is only sold in {baseUnit ? baseUnit.name.toLowerCase() + "s" : "its base unit"}.</p>}
          <div className="space-y-3">
            {rows.map((row, i) => {
              const u = units.find((x) => x.id === row.unitId);
              return (
                <div key={row.unitId} className="rounded-lg border border-line bg-slate-50/60 p-3">
                  <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr_1fr_auto]">
                    <div>
                      <p className="mb-1.5 text-[13px] font-medium text-slate-700">Packaging unit</p>
                      <p className="flex min-h-9 items-center text-sm font-medium text-slate-900">{u?.name ?? "Unknown"}</p>
                    </div>
                    <div className="sm:w-44">
                      <label className="label" htmlFor={`factor-${i}`}>
                        1 {u?.symbol ?? "unit"} =
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          id={`factor-${i}`}
                          inputMode="decimal"
                          value={row.factor}
                          disabled={disabled}
                          onChange={(e) => updateRow(i, { factor: e.target.value })}
                          className="input"
                          placeholder="12"
                        />
                        <span className="whitespace-nowrap text-sm text-slate-500">{baseUnit?.symbol ?? "base"}</span>
                      </div>
                    </div>
                    <div>
                      <label className="label" htmlFor={`sp-${i}`}>
                        Selling price {canPrice ? "(optional)" : ""}
                      </label>
                      <input
                        id={`sp-${i}`}
                        inputMode="decimal"
                        value={row.sellingPrice}
                        disabled={disabled || !canPrice}
                        onChange={(e) => updateRow(i, { sellingPrice: e.target.value })}
                        className="input"
                        placeholder="Auto"
                      />
                    </div>
                    <div>
                      <label className="label" htmlFor={`wp-${i}`}>
                        Wholesale price {canPrice ? "(optional)" : ""}
                      </label>
                      <input
                        id={`wp-${i}`}
                        inputMode="decimal"
                        value={row.wholesalePrice}
                        disabled={disabled || !canPrice}
                        onChange={(e) => updateRow(i, { wholesalePrice: e.target.value })}
                        className="input"
                        placeholder="Auto"
                      />
                    </div>
                    {!disabled && (
                      <button type="button" className="btn-secondary btn-sm mb-0.5" onClick={() => setRows((r) => r.filter((_, idx) => idx !== i))} aria-label={`Remove ${u?.name}`}>
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                  <p className="hint">
                    {row.factor && u && baseUnit ? `Selling 2 ${u.name.toLowerCase()}s will deduct ${Number(row.factor) * 2 || "—"} ${baseUnit.name.toLowerCase()}s from stock. ` : ""}
                    Leave prices empty to use base price × {row.factor || "factor"}.
                  </p>
                </div>
              );
            })}
          </div>
          {fe.units && <p className="field-error">{fe.units}</p>}
          {!disabled && (
            <div className="mt-3">
              <label className="sr-only" htmlFor="add-unit">
                Add packaging unit
              </label>
              <select
                id="add-unit"
                className="input max-w-xs"
                value=""
                disabled={!baseUnitId || addable.length === 0}
                onChange={(e) => e.target.value && setRows((r) => [...r, { unitId: e.target.value, factor: "", sellingPrice: "", wholesalePrice: "" }])}
              >
                <option value="">{baseUnitId ? "+ Add packaging unit…" : "Choose the base unit first"}</option>
                {addable.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.symbol})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </section>

      <section className="card card-pad">
        <h2 className="mb-4 text-base font-semibold text-slate-900">Pricing &amp; stock control</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Field
            label={`Purchase price per ${baseUnit?.symbol ?? "base unit"} (${currencySymbol})`}
            name="purchasePrice"
            error={fe.purchasePrice}
            required={canCost}
            hint={canCost ? undefined : "Only users allowed to manage costs can set this."}
          >
            <input
              id="purchasePrice"
              name="purchasePrice"
              inputMode="decimal"
              defaultValue={canCost ? v("purchasePrice") : ""}
              disabled={disabled || !canCost}
              placeholder={canCost ? "" : "Hidden"}
              className={inputClass(fe.purchasePrice)}
            />
          </Field>
          <Field
            label={`Selling price per ${baseUnit?.symbol ?? "base unit"} (${currencySymbol})`}
            name="sellingPrice"
            error={fe.sellingPrice}
            required={canPrice}
            hint={canPrice ? undefined : isEdit ? undefined : "You cannot set prices; it will be saved as 0 until someone authorised sets it."}
          >
            <input id="sellingPrice" name="sellingPrice" inputMode="decimal" defaultValue={v("sellingPrice")} disabled={disabled || !canPrice} className={inputClass(fe.sellingPrice)} />
          </Field>
          <Field label={`Wholesale price per ${baseUnit?.symbol ?? "base unit"} (${currencySymbol})`} name="wholesalePrice" error={fe.wholesalePrice} hint="Optional.">
            <input id="wholesalePrice" name="wholesalePrice" inputMode="decimal" defaultValue={v("wholesalePrice")} disabled={disabled || !canPrice} className={inputClass(fe.wholesalePrice)} />
          </Field>
          <Field
            label={`Minimum stock level${baseUnit ? ` (${baseUnit.symbol})` : ""}`}
            name="minStock"
            error={fe.minStock}
            hint="You are alerted when stock falls to this level."
          >
            <input id="minStock" name="minStock" inputMode="decimal" defaultValue={v("minStock") || "0"} disabled={disabled} className={inputClass(fe.minStock)} />
          </Field>
        </div>
        <p className="mt-4 rounded-lg bg-navy-50 px-3 py-2 text-sm text-navy-800">
          Current stock is not typed here. It changes only through stock receiving, sales and adjustments, so every movement is recorded.
        </p>
      </section>

      {!disabled && (
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton>{isEdit ? "Save changes" : "Create product"}</SubmitButton>
          <Link href="/products" className="btn-secondary">
            Cancel
          </Link>
        </div>
      )}
    </form>
  );
}
