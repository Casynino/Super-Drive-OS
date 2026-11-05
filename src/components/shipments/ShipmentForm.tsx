"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Alert } from "@/components/ui";
import { Field, SubmitButton, inputClass } from "@/components/FormBits";
import StockLinesEditor from "@/components/inventory/StockLinesEditor";
import NewProductPanel from "./NewProductPanel";
import type { ActionState } from "@/lib/action";
import type { EditorLine, LocationOption, PickerProduct } from "@/lib/inventory/types";

type Option = { id: string; name: string };
type Props = {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  createProduct: (fd: FormData) => Promise<{ ok: true; product: PickerProduct } | { ok: false; error: string }>;
  products: PickerProduct[];
  locations: LocationOption[];
  suppliers: Option[];
  categories: Option[];
  brands: Option[];
  canPrice: boolean;
  currencySymbol: string;
  submissionKey: string;
};

const initial: ActionState = {};

export default function ShipmentForm({ action, createProduct, products: initialProducts, locations, suppliers, categories, brands, canPrice, currencySymbol, submissionKey: key }: Props) {
  const [state, formAction] = useActionState(action, initial);
  const fe = state.fieldErrors ?? {};
  const [submissionKey] = useState(key);
  const [products, setProducts] = useState(initialProducts);
  const [lines, setLines] = useState<EditorLine[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [reference, setReference] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [locationId, setLocationId] = useState(locations.find((l) => l.isDefault)?.id ?? locations[0]?.id ?? "");
  const [notes, setNotes] = useState("");

  const payload = JSON.stringify({
    supplierId: supplierId || null,
    reference: reference.trim() || null,
    expectedDate: expectedDate || null,
    locationId,
    notes: notes.trim() || null,
    lines: lines.map((l) => ({ productId: l.productId, unitId: l.unitId, quantity: l.quantity, totalCost: l.totalCost })),
    submissionKey,
  });

  return (
    <form action={formAction} noValidate className="space-y-5" onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault(); }}>
      <input type="hidden" name="payloadJson" value={payload} />
      {state.error && <Alert>{state.error}</Alert>}

      <section className="card card-pad">
        <h2 className="mb-4 text-base font-semibold text-slate-900">Shipment details</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Supplier" name="supplierId" error={fe.supplierId} hint="Optional. Add suppliers under Supplier Accounts.">
            <select id="supplierId" className={inputClass(fe.supplierId)} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">No supplier</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tracking / container / invoice no." name="reference">
            <input id="reference" className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. container number" />
          </Field>
          <Field label="Expected arrival" name="expectedDate">
            <input id="expectedDate" type="date" className="input" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
          </Field>
          <Field label="Deliver to" name="locationId" error={fe.locationId} required>
            <select id="locationId" className={inputClass(fe.locationId)} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notes for the shop" name="notes" className="md:col-span-2">
            <textarea id="notes" rows={2} className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. 2 trucks, second truck comes Friday" />
          </Field>
        </div>
      </section>

      <section className="card card-pad">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">What is coming</h2>
            <p className="text-sm text-slate-500">Search an existing product, or add a brand-new one with its picture. The shop never sees the costs.</p>
          </div>
          <NewProductPanel
            categories={categories}
            brands={brands}
            canPrice={canPrice}
            currencySymbol={currencySymbol}
            create={createProduct}
            onCreated={(p) => {
              setProducts((all) => [...all, p]);
              setLines((l) => [...l, { productId: p.id, unitId: p.units[p.units.length - 1]!.id, quantity: "", totalCost: "" }]);
            }}
          />
        </div>
        <StockLinesEditor products={products} lines={lines} onChange={setLines} showCost quantityLabel="Quantity expected" currencySymbol={currencySymbol} errors={fe} />
        <p className="hint mt-3">Total cost = what this line cost you in total, delivered (goods + shipping + duties), in {currencySymbol}.</p>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Announcing…">Announce shipment</SubmitButton>
        <Link href="/shipments" className="btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
