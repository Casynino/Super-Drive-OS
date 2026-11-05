"use client";

import { useRef, useState, useTransition } from "react";
import { ImagePlus, PackagePlus, X } from "lucide-react";
import type { PickerProduct } from "@/lib/inventory/types";

type Option = { id: string; name: string };
type Props = {
  categories: Option[];
  brands: Option[];
  canPrice: boolean;
  currencySymbol: string;
  create: (fd: FormData) => Promise<{ ok: true; product: PickerProduct } | { ok: false; error: string }>;
  onCreated: (product: PickerProduct) => void;
};

/** Add a product that does not exist yet, with its picture, without leaving the shipment form. */
export default function NewProductPanel({ categories, brands, canPrice, currencySymbol, create, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const form = useRef<HTMLFormElement>(null);

  if (!open) {
    return (
      <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
        <PackagePlus size={16} /> New product
      </button>
    );
  }

  const submit = () => {
    const fd = new FormData(form.current!);
    start(async () => {
      setError(null);
      const r = await create(fd);
      if (!r.ok) return setError(r.error);
      onCreated(r.product);
      form.current?.reset();
      setPreview(null);
      setOpen(false);
    });
  };

  return (
    <div className="card card-pad border-navy-200 bg-navy-50/40">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-900">New product</h3>
        <button type="button" className="btn-secondary btn-sm" onClick={() => setOpen(false)} aria-label="Close">
          <X size={14} />
        </button>
      </div>
      {/* a nested <form> is invalid inside the shipment form, so this is a plain container read via FormData */}
      <form ref={form} onSubmit={(e) => e.preventDefault()} className="grid gap-3 md:grid-cols-[132px_1fr]">
        <label className="flex h-32 w-32 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-white text-xs text-slate-400 hover:border-navy-400">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Preview" className="h-full w-full object-contain" />
          ) : (
            <span className="flex flex-col items-center gap-1">
              <ImagePlus size={24} />
              Add picture
            </span>
          )}
          <input type="file" name="image" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; setPreview(f ? URL.createObjectURL(f) : null); }} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="np-name">
              Product name <span className="text-brand-red">*</span>
            </label>
            <input id="np-name" name="name" className="input" placeholder="e.g. Total 10W-40 4L" />
          </div>
          <div>
            <label className="label" htmlFor="np-cat">
              Category <span className="text-brand-red">*</span>
            </label>
            <select id="np-cat" name="categoryId" className="input" defaultValue="">
              <option value="">Choose…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="np-brand">
              Brand
            </label>
            <select id="np-brand" name="brandId" className="input" defaultValue="">
              <option value="">No brand</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="np-pack">
              Packaging
            </label>
            <input id="np-pack" name="packaging" className="input" placeholder="e.g. 4L tin, 1L bottle" />
          </div>
          <div>
            <label className="label" htmlFor="np-ctn">
              Pieces per carton
            </label>
            <input id="np-ctn" name="perCarton" className="input" inputMode="numeric" placeholder="e.g. 6 (empty = no cartons)" />
          </div>
          {canPrice && (
            <div className="sm:col-span-2">
              <label className="label" htmlFor="np-price">
                Selling price per piece ({currencySymbol}) <span className="font-normal text-slate-400">(you can set it later)</span>
              </label>
              <input id="np-price" name="sellingPrice" className="input max-w-xs" inputMode="decimal" />
            </div>
          )}
        </div>
      </form>
      {error && <p className="field-error mt-2">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" className="btn-primary" onClick={submit} disabled={pending}>
          {pending ? "Creating…" : "Create and add to shipment"}
        </button>
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
