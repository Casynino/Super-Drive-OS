"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { Truck } from "lucide-react";
import { Alert } from "@/components/ui";
import { Field, SubmitButton, inputClass } from "@/components/FormBits";
import ShipmentLinesEditor, { lineFigures, newLine, type ShipmentLine } from "./ShipmentLinesEditor";
import NewProductPanel from "./NewProductPanel";
import type { ActionState } from "@/lib/action";
import type { LocationOption, PickerProduct } from "@/lib/inventory/types";

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
const money = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(n));

function Step({ n, title, children }: { n: number; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy-700 text-sm font-semibold text-white">{n}</span>
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-semibold leading-7 text-slate-900">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export default function ShipmentForm({ action, createProduct, products: initialProducts, locations, suppliers, categories, brands, canPrice, currencySymbol, submissionKey: key }: Props) {
  const [state, formAction] = useActionState(action, initial);
  const fe = state.fieldErrors ?? {};
  const [submissionKey] = useState(key);
  const [products, setProducts] = useState(initialProducts);
  const [lines, setLines] = useState<ShipmentLine[]>([]);
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
    lines: lines.map((l) => ({
      productId: l.productId,
      unitId: l.unitId,
      quantity: l.quantity,
      totalCost: l.totalCost,
      ...(canPrice ? { sellingPrice: l.sellingPrice.trim(), wholesalePrice: l.wholesalePrice.trim() } : {}),
    })),
    submissionKey,
  });

  const totals = useMemo(() => {
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
    // profit is only shown for the lines that have both a buying and a selling price
    return { cost, sales, pieces, profit: sales - priced, margin: sales > 0 ? ((sales - priced) / sales) * 100 : NaN };
  }, [lines, products]);

  const oneLocation = locations.length === 1;

  return (
    <form action={formAction} noValidate className="space-y-5 pb-32 lg:pb-24" onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault(); }}>
      <input type="hidden" name="payloadJson" value={payload} />
      {state.error && <Alert>{state.error}</Alert>}

      <section className="card card-pad">
        <Step n={1} title="Where is it coming from?">
          <div className="mt-4 grid gap-4 md:grid-cols-2">
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
            <Field label="Container, tracking or invoice number" name="reference">
              <input id="reference" className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. container number" />
            </Field>
            <Field label="Expected arrival" name="expectedDate">
              <input id="expectedDate" type="date" className="input" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
            </Field>
            {oneLocation ? (
              <div>
                <p className="label">Deliver to</p>
                <p className="flex min-h-10 items-center rounded-lg bg-slate-50 px-3 text-sm font-medium text-slate-700">{locations[0]!.name}</p>
              </div>
            ) : (
              <Field label="Deliver to" name="locationId" error={fe.locationId} required>
                <select id="locationId" className={inputClass(fe.locationId)} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Note for the shop" name="notes" className="md:col-span-2">
              <textarea id="notes" rows={2} className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. 2 trucks, the second one comes Friday" />
            </Field>
          </div>
        </Step>
      </section>

      <section className="card card-pad">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Step n={2} title="What did you buy?">
            <p className="text-sm text-slate-500">
              Add each product with how many, what you paid and what you will sell it for.{" "}
              {canPrice ? "New selling prices start when the stock arrives. " : ""}The shop never sees what you paid.
            </p>
          </Step>
          <NewProductPanel
            categories={categories}
            brands={brands}
            canPrice={false}
            currencySymbol={currencySymbol}
            create={createProduct}
            onCreated={(p) => {
              setProducts((all) => [...all, p]);
              setLines((l) => [...l, newLine(p, p.units[p.units.length - 1]?.id)]);
            }}
          />
        </div>
        <div className="mt-4">
          <ShipmentLinesEditor products={products} lines={lines} onChange={setLines} canPrice={canPrice} currencySymbol={currencySymbol} errors={fe} />
        </div>
        <p className="hint mt-3">The buying price should be what it cost you delivered: goods, shipping and duties together.</p>
      </section>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 px-4 py-3 shadow-[0_-4px_12px_rgba(15,27,45,0.08)] backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-[1920px] flex-wrap items-center justify-between gap-x-6 gap-y-2 lg:px-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <span className="text-slate-600">
              <span className="font-semibold text-slate-900">{lines.length}</span> product{lines.length === 1 ? "" : "s"}
              {totals.pieces > 0 && <> · {money(totals.pieces)} pieces</>}
            </span>
            <span className="text-slate-600">
              You pay <span className="font-semibold text-slate-900">{currencySymbol} {money(totals.cost)}</span>
            </span>
            {canPrice && totals.sales > 0 && (
              <>
                <span className="hidden text-slate-600 sm:inline">
                  Sells for <span className="font-semibold text-slate-900">{currencySymbol} {money(totals.sales)}</span>
                </span>
                <span className={totals.profit >= 0 ? "font-semibold text-emerald-700" : "font-semibold text-brand-red-dark"}>
                  {totals.profit >= 0 ? "Profit" : "Loss"} {currencySymbol} {money(Math.abs(totals.profit))}
                  {Number.isFinite(totals.margin) && ` (${Math.round(totals.margin)}%)`}
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link href="/shipments" className="btn-secondary">
              Cancel
            </Link>
            <SubmitButton pendingLabel="Sending…" className="btn-primary min-h-11 px-5">
              <span className="inline-flex items-center gap-2">
                <Truck size={16} /> Send to the shop
              </span>
            </SubmitButton>
          </div>
        </div>
      </div>
    </form>
  );
}
