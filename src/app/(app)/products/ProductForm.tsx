"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
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
  size: string;
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

  const isEdit = Boolean(product);
  const piece = units.find((u) => u.symbol === "pc");
  const carton = units.find((u) => u.symbol === "ctn");

  const [baseUnitId, setBaseUnitId] = useState(v("baseUnitId") || piece?.id || "");
  const [rows, setRows] = useState<UnitRow[]>(() => {
    try {
      if (state.values?.unitsJson) return JSON.parse(state.values.unitsJson) as UnitRow[];
    } catch {}
    return product?.units ?? [];
  });
  // Adding a product: "pieces per carton" is one simple box (when the shop has a Carton unit); editing keeps the full packaging list.
  const simplePack = !isEdit && Boolean(carton);
  const [perCarton, setPerCarton] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const packRows: UnitRow[] = simplePack ? (perCarton.trim() && carton ? [{ unitId: carton.id, factor: perCarton.trim(), sellingPrice: "", wholesalePrice: "" }] : []) : rows;

  const baseUnit = units.find((u) => u.id === baseUnitId);
  const disabled = readOnly;
  const usedIds = new Set([baseUnitId, ...rows.map((r) => r.unitId)]);
  const addable = units.filter((u) => !usedIds.has(u.id));
  const updateRow = (i: number, patch: Partial<UnitRow>) => setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  const categorySelect = (
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
  );
  const brandSelect = (
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
  );

  return (
    <form action={action} className="space-y-5" noValidate>
      {product && <input type="hidden" name="id" value={product.id} />}
      <input type="hidden" name="unitsJson" value={JSON.stringify(packRows)} />
      {!isEdit && <input type="hidden" name="baseUnitId" value={baseUnitId} />}

      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && state.message && <Alert kind="success">{state.message}</Alert>}

      <section className="card card-pad">
        <h2 className="mb-4 text-base font-semibold text-slate-900">{isEdit ? "Basic information" : "The product"}</h2>
        <div className={isEdit ? "" : "grid gap-5 md:grid-cols-[168px_1fr]"}>
          {!isEdit && (
            <div>
              <label className="flex aspect-square w-full max-w-[168px] cursor-pointer items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 text-xs text-slate-400 transition hover:border-navy-400 hover:text-navy-600">
                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview} alt="Preview" className="h-full w-full object-contain" />
                ) : (
                  <span className="flex flex-col items-center gap-1.5 px-2 text-center">
                    <ImagePlus size={28} />
                    Add a picture
                  </span>
                )}
                <input type="file" name="image" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; setPreview(f ? URL.createObjectURL(f) : null); }} />
              </label>
              {fe.image && <p className="field-error">{fe.image}</p>}
              <p className="mt-2 text-xs text-slate-500">Optional. A photo from your phone is fine.</p>
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Product name" name="name" error={fe.name} required className="md:col-span-2">
              <input id="name" name="name" defaultValue={v("name")} disabled={disabled} className={inputClass(fe.name)} placeholder="e.g. Castrol GTX 20W-50 5L" autoFocus={!isEdit} />
            </Field>
            {categorySelect}
            {brandSelect}
            {isEdit ? (
              <>
                <Field label="Size" name="size" error={fe.size} hint="e.g. 5L. Shown on labels.">
                  <input id="size" name="size" defaultValue={v("size")} disabled={disabled} className={inputClass(fe.size)} />
                </Field>
                <Field label="Packaging type" name="packagingType" error={fe.packagingType} hint="e.g. Jerrycan, Bottle, Drum, Pail.">
                  <input id="packagingType" name="packagingType" defaultValue={v("packagingType")} disabled={disabled} className={inputClass(fe.packagingType)} />
                </Field>
                <Field label="Description" name="description" error={fe.description} className="md:col-span-2">
                  <textarea id="description" name="description" rows={2} defaultValue={v("description")} disabled={disabled} className={inputClass(fe.description)} />
                </Field>
              </>
            ) : (
              <div className="md:col-span-2">
                <p className="rounded-lg bg-navy-50 px-3 py-2 text-sm text-navy-800">The product code, the barcode and the QR code are made for you when you save. You never type them.</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {isEdit && (
        <section className="card card-pad">
          <h2 className="mb-1 text-base font-semibold text-slate-900">Product codes</h2>
          <p className="mb-4 text-sm text-slate-500">Made by the system. Change the barcode only if the bottle already has a barcode printed by the maker and you want to scan that one instead.</p>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Product code" name="sku" error={fe.sku} hint="Letters and numbers, e.g. CAS-GTX-5L.">
              <input id="sku" name="sku" defaultValue={v("sku")} disabled={disabled} className={inputClass(fe.sku)} autoCapitalize="characters" />
            </Field>
            <Field label="Barcode" name="barcode" error={fe.barcode}>
              <input id="barcode" name="barcode" defaultValue={v("barcode")} disabled={disabled} className={inputClass(fe.barcode)} inputMode="numeric" />
            </Field>
          </div>
        </section>
      )}

      <section className="card card-pad">
        <h2 className="text-base font-semibold text-slate-900">{isEdit ? "Units & packaging" : "How is it sold?"}</h2>
        {isEdit ? (
          <p className="mb-4 mt-1 text-sm text-slate-500">Stock is always counted in the base unit. If you sell bigger packs (cartons, drums), add them below so stock is deducted correctly.</p>
        ) : (
          <p className="mb-4 mt-1 text-sm text-slate-500">Stock is counted in pieces. If it also comes in cartons, say how many pieces are in one.</p>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          {isEdit ? (
            <Field label="Base unit" name="baseUnitId" error={fe.baseUnitId} required hint="The base unit cannot be changed after the product is created.">
              <select id="baseUnitId" name="baseUnitId" value={baseUnitId} onChange={(e) => setBaseUnitId(e.target.value)} disabled className={inputClass(fe.baseUnitId)}>
                <option value="">Choose unit…</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.symbol})
                  </option>
                ))}
              </select>
              <input type="hidden" name="baseUnitId" value={baseUnitId} />
            </Field>
          ) : (
            <Field label="Counted in" name="baseUnitId" id="baseUnitId-select" error={fe.baseUnitId} required>
              <select id="baseUnitId-select" value={baseUnitId} onChange={(e) => setBaseUnitId(e.target.value)} className={inputClass(fe.baseUnitId)}>
                <option value="">Choose unit…</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.symbol})
                  </option>
                ))}
              </select>
            </Field>
          )}
          {simplePack && (
            <Field label="Pieces in one carton" name="perCarton" error={fe.units} hint="Leave empty if it is not sold by the carton.">
              <input id="perCarton" inputMode="numeric" className={inputClass(fe.units)} placeholder="e.g. 12" value={perCarton} onChange={(e) => setPerCarton(e.target.value.replace(/[^\d.]/g, ""))} />
            </Field>
          )}
        </div>

        {!simplePack && (
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
                          <input id={`factor-${i}`} inputMode="decimal" value={row.factor} disabled={disabled} onChange={(e) => updateRow(i, { factor: e.target.value })} className="input" placeholder="12" />
                          <span className="whitespace-nowrap text-sm text-slate-500">{baseUnit?.symbol ?? "base"}</span>
                        </div>
                      </div>
                      <div>
                        <label className="label" htmlFor={`sp-${i}`}>
                          Selling price {canPrice ? "(optional)" : ""}
                        </label>
                        <input id={`sp-${i}`} inputMode="decimal" value={row.sellingPrice} disabled={disabled || !canPrice} onChange={(e) => updateRow(i, { sellingPrice: e.target.value })} className="input" placeholder="Auto" />
                      </div>
                      <div>
                        <label className="label" htmlFor={`wp-${i}`}>
                          Wholesale price {canPrice ? "(optional)" : ""}
                        </label>
                        <input id={`wp-${i}`} inputMode="decimal" value={row.wholesalePrice} disabled={disabled || !canPrice} onChange={(e) => updateRow(i, { wholesalePrice: e.target.value })} className="input" placeholder="Auto" />
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
        )}
      </section>

      <section className="card card-pad">
        <h2 className="mb-4 text-base font-semibold text-slate-900">Prices &amp; stock alert</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Field
            label={`Selling price per ${baseUnit?.symbol ?? "piece"} (${currencySymbol})`}
            name="sellingPrice"
            error={fe.sellingPrice}
            required={isEdit && canPrice}
            hint={canPrice ? (isEdit ? undefined : "You can also set it when you send a shipment.") : isEdit ? undefined : "You cannot set prices; it will be saved as 0 until someone authorised sets it."}
          >
            <input id="sellingPrice" name="sellingPrice" inputMode="decimal" defaultValue={v("sellingPrice")} disabled={disabled || !canPrice} className={inputClass(fe.sellingPrice)} />
          </Field>
          <Field label={`Wholesale price per ${baseUnit?.symbol ?? "piece"} (${currencySymbol})`} name="wholesalePrice" error={fe.wholesalePrice} hint="Optional.">
            <input id="wholesalePrice" name="wholesalePrice" inputMode="decimal" defaultValue={v("wholesalePrice")} disabled={disabled || !canPrice} className={inputClass(fe.wholesalePrice)} />
          </Field>
          <Field label={`Alert me when stock falls to${baseUnit ? ` (${baseUnit.symbol})` : ""}`} name="minStock" error={fe.minStock} hint="Minimum stock level.">
            <input id="minStock" name="minStock" inputMode="decimal" defaultValue={v("minStock") || "0"} disabled={disabled} className={inputClass(fe.minStock)} />
          </Field>
          <Field
            label={`Buying price per ${baseUnit?.symbol ?? "piece"} (${currencySymbol})`}
            name="purchasePrice"
            error={fe.purchasePrice}
            required={isEdit && canCost}
            hint={canCost ? (isEdit ? undefined : "Optional. The shipment sets the real cost when stock arrives.") : "Only users allowed to manage costs can set this."}
          >
            <input id="purchasePrice" name="purchasePrice" inputMode="decimal" defaultValue={canCost ? v("purchasePrice") : ""} disabled={disabled || !canCost} placeholder={canCost ? "" : "Hidden"} className={inputClass(fe.purchasePrice)} />
          </Field>
        </div>
        {!isEdit && (
          <details className="mt-4 rounded-lg border border-line px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">More details (optional)</summary>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <Field label="Size" name="size" error={fe.size} hint="e.g. 5L. Shown on labels.">
                <input id="size" name="size" defaultValue={v("size")} className={inputClass(fe.size)} />
              </Field>
              <Field label="Packaging type" name="packagingType" error={fe.packagingType} hint="e.g. Jerrycan, Bottle, Drum, Pail.">
                <input id="packagingType" name="packagingType" defaultValue={v("packagingType")} className={inputClass(fe.packagingType)} />
              </Field>
              <Field label="Description" name="description" error={fe.description} className="md:col-span-2">
                <textarea id="description" name="description" rows={2} defaultValue={v("description")} className={inputClass(fe.description)} />
              </Field>
            </div>
          </details>
        )}
        <p className="mt-4 rounded-lg bg-navy-50 px-3 py-2 text-sm text-navy-800">Current stock is not typed here. It changes only through stock receiving, sales and adjustments, so every movement is recorded.</p>
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
