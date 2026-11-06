"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, PackageCheck, Truck } from "lucide-react";
import { Alert } from "@/components/ui";
import { Field, SubmitButton, inputClass } from "@/components/FormBits";
import PackingList, { packingTotals } from "./PackingList";
import ShipmentLinesEditor, { lineFigures, newLine, type ShipmentLine } from "./ShipmentLinesEditor";
import NewProductPanel from "./NewProductPanel";
import type { ActionState } from "@/lib/action";
import type { LocationOption, PickerProduct } from "@/lib/inventory/types";
import { cn, formatDate } from "@/lib/utils";

type Option = { id: string; name: string };
type Props = {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  createProduct: (fd: FormData) => Promise<{ ok: true; product: PickerProduct } | { ok: false; error: string }>;
  products: PickerProduct[];
  locations: LocationOption[];
  suppliers: Option[];
  /** may type a supplier that is not on the list yet (needs the right to add suppliers) */
  canAddSupplier: boolean;
  categories: Option[];
  brands: Option[];
  /** cargo companies used before, offered as suggestions */
  cargoNames: string[];
  canPrice: boolean;
  currencySymbol: string;
  submissionKey: string;
};

const initial: ActionState = {};
const money = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(n));
const STEPS = [
  { n: 1, title: "Details", sub: "Where from, when" },
  { n: 2, title: "Packing list", sub: "What you bought" },
  { n: 3, title: "Review and seal", sub: "Check and send" },
] as const;

function Stepper({ step, onGo, reached }: { step: number; onGo: (n: 1 | 2 | 3) => void; reached: number }) {
  return (
    <ol className="mb-5 grid grid-cols-3 gap-2 sm:gap-4" aria-label="Steps">
      {STEPS.map((s) => {
        const done = s.n < step;
        const current = s.n === step;
        const clickable = s.n <= reached && s.n !== step;
        return (
          <li key={s.n}>
            <button
              type="button"
              disabled={!clickable}
              onClick={() => onGo(s.n)}
              aria-current={current ? "step" : undefined}
              className={cn("flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition", current ? "border-navy-600 bg-navy-50" : done ? "border-emerald-300 bg-emerald-50/60" : "border-line bg-white", clickable && "hover:border-navy-300")}
            >
              <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold", current ? "bg-navy-700 text-white" : done ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-500")}>
                {done ? <Check size={16} strokeWidth={3} /> : s.n}
              </span>
              <span className="hidden min-w-0 sm:block">
                <span className={cn("block truncate text-sm font-semibold", current ? "text-navy-800" : "text-slate-800")}>{s.title}</span>
                <span className="block truncate text-xs text-slate-500">{s.sub}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export default function ShipmentForm({ action, createProduct, products: initialProducts, locations, suppliers, canAddSupplier, categories, brands, cargoNames, canPrice, currencySymbol, submissionKey: key }: Props) {
  const [state, formAction] = useActionState(action, initial);
  const fe = state.fieldErrors ?? {};
  const [submissionKey] = useState(key);
  const [products, setProducts] = useState(initialProducts);
  const [lines, setLines] = useState<ShipmentLine[]>([]);
  const [supplierText, setSupplierText] = useState("");
  const [cargoName, setCargoName] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [locationId, setLocationId] = useState(locations.find((l) => l.isDefault)?.id ?? locations[0]?.id ?? "");
  const [notes, setNotes] = useState("");
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [reached, setReached] = useState(1);
  const [checked, setChecked] = useState(false);
  const [nudge, setNudge] = useState<string | null>(null);

  // the server found a problem: go back to the step where it can be fixed
  useEffect(() => {
    if (Object.keys(fe).some((k) => k.startsWith("line.") || k === "lines")) setStep(2);
    else if (fe.supplierId || fe.supplierName || fe.locationId) setStep(1);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (n: 1 | 2 | 3) => {
    setNudge(null);
    setStep(n);
    setReached((r) => Math.max(r, n));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const totals = useMemo(() => packingTotals(lines, products), [lines, products]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const problem = useMemo(() => {
    if (lines.length === 0) return "Add at least one product to the packing list.";
    for (const l of lines) {
      const f = lineFigures(l, byId.get(l.productId));
      if (!Number.isFinite(f.baseQty)) return `Say how many ${byId.get(l.productId)?.name ?? "of each product"} you bought.`;
      if (!Number.isFinite(f.total) || f.total <= 0) return `Enter what ${byId.get(l.productId)?.name ?? "each product"} cost you.`;
    }
    return null;
  }, [lines, byId]);

  // a name typed here is either one already on the list or a new supplier that is added when the order is sealed
  const typedSupplier = supplierText.trim();
  const matchedSupplier = typedSupplier ? suppliers.find((s) => s.name.toLowerCase() === typedSupplier.toLowerCase()) : undefined;
  const newSupplierName = typedSupplier && !matchedSupplier ? typedSupplier : null;

  const payload = JSON.stringify({
    supplierId: matchedSupplier?.id ?? null,
    newSupplierName: newSupplierName,
    reference: null,
    cargoName: cargoName.trim() || null,
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

  const oneLocation = locations.length === 1;
  const supplierName = matchedSupplier?.name ?? (newSupplierName ? `${newSupplierName} (new supplier)` : undefined);
  const locationName = locations.find((l) => l.id === locationId)?.name;

  const next = () => {
    if (step === 1) return go(2);
    if (step === 2) {
      if (problem) return setNudge(problem);
      return go(3);
    }
  };

  return (
    <form action={formAction} noValidate className="pb-32 lg:pb-24" onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault(); }}>
      <input type="hidden" name="payloadJson" value={payload} />
      <Stepper step={step} onGo={go} reached={reached} />
      {state.error && (
        <div className="mb-4">
          <Alert>{state.error}</Alert>
        </div>
      )}

      {/* ───────── Step 1: details ───────── */}
      {step === 1 && (
        <section className="card card-pad">
          <h2 className="text-base font-semibold text-slate-900">Where is it coming from?</h2>
          <p className="text-sm text-slate-500">Only a few things. You can leave the optional ones empty.</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {canAddSupplier ? (
              <Field label="Supplier" name="supplierName" error={fe.supplierName ?? fe.supplierId} hint={newSupplierName ? "New supplier: it is added to Supplier Accounts when you seal the order." : "Optional. Pick one from the list or type a new name."}>
                <input id="supplierName" className={inputClass(fe.supplierName ?? fe.supplierId)} list="supplier-names" value={supplierText} onChange={(e) => setSupplierText(e.target.value)} placeholder="e.g. the supplier's name" autoComplete="off" maxLength={120} />
                <datalist id="supplier-names">
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.name} />
                  ))}
                </datalist>
              </Field>
            ) : (
              <Field label="Supplier" name="supplierId" error={fe.supplierId} hint="Optional. Only the owner can add new suppliers.">
                <select id="supplierId" className={inputClass(fe.supplierId)} value={matchedSupplier?.name ?? ""} onChange={(e) => setSupplierText(e.target.value)}>
                  <option value="">No supplier</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Cargo company" name="cargoName" hint="Which cargo is bringing it to Tanzania?">
              <input id="cargoName" className="input" list="cargo-names" value={cargoName} onChange={(e) => setCargoName(e.target.value)} placeholder="e.g. the cargo company's name" autoComplete="off" />
              <datalist id="cargo-names">
                {cargoNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
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
        </section>
      )}

      {/* ───────── Step 2: the packing list ───────── */}
      {step === 2 && (
        <div className="grid items-start gap-5 xl:grid-cols-[1fr_380px]">
          <section className="card card-pad min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">What did you buy?</h2>
                <p className="text-sm text-slate-500">
                  Add each product with how many, what you paid{canPrice ? " and what you will sell it for" : ""}. The shop never sees what you paid.
                </p>
              </div>
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
            <p className="hint mt-3">
              The buying price should be what it cost you delivered: goods, shipping and duties together.{canPrice ? " New selling prices start when the stock arrives." : ""}
            </p>
          </section>
          <PackingList lines={lines} products={products} canPrice={canPrice} currencySymbol={currencySymbol} compact onRemove={(id) => setLines((all) => all.filter((l) => l.productId !== id))} className="xl:sticky xl:top-20" />
        </div>
      )}

      {/* ───────── Step 3: review and seal ───────── */}
      {step === 3 && (
        <div className="space-y-5">
          <section className="card card-pad">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Check the batch</h2>
                <p className="text-sm text-slate-500">Look it over. When you seal it, it goes on the way and the shop is told. After the shop marks it arrived it cannot be cancelled.</p>
              </div>
              <button type="button" className="btn-secondary btn-sm" onClick={() => go(1)}>
                Edit details
              </button>
            </div>
            <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              {[
                { k: "Supplier", v: supplierName ?? "—" },
                { k: "Cargo company", v: cargoName.trim() || "—" },
                { k: "Expected arrival", v: expectedDate ? formatDate(new Date(`${expectedDate}T00:00:00Z`)) : "—" },
                { k: "Deliver to", v: locationName ?? "—" },
              ].map((r) => (
                <div key={r.k}>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{r.k}</dt>
                  <dd className="mt-0.5 font-medium text-slate-900">{r.v}</dd>
                </div>
              ))}
              {notes.trim() && (
                <div className="sm:col-span-2 lg:col-span-4">
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Note for the shop</dt>
                  <dd className="mt-0.5 text-slate-800">{notes.trim()}</dd>
                </div>
              )}
            </dl>
          </section>

          <PackingList
            lines={lines}
            products={products}
            canPrice={canPrice}
            currencySymbol={currencySymbol}
            headerAction={
              <button type="button" className="btn-secondary btn-sm" onClick={() => go(2)}>
                Edit packing list
              </button>
            }
          />

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-white px-4 py-3.5 text-sm text-slate-800">
            <input type="checkbox" className="mt-0.5 h-5 w-5 rounded border-slate-400" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            <span>
              <strong>I have checked the packing list.</strong> The products, the numbers and the prices are right, and I want to seal this batch and send it to the shop.
            </span>
          </label>
        </div>
      )}

      {/* ───────── Bottom bar ───────── */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 px-4 py-3 shadow-[0_-4px_12px_rgba(15,27,45,0.08)] backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-[1920px] flex-wrap items-center justify-between gap-x-6 gap-y-2 lg:px-4">
          <div className="min-w-0 text-sm">
            {nudge ? (
              <p role="alert" className="font-medium text-brand-red-dark">
                {nudge}
              </p>
            ) : step === 1 ? (
              <p className="text-slate-600">Step 1 of 3. Next you build the packing list.</p>
            ) : (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                <span className="text-slate-600">
                  <span className="font-semibold text-slate-900">{totals.products}</span> product{totals.products === 1 ? "" : "s"}
                  {totals.pieces > 0 && <> · {money(totals.pieces)} pieces</>}
                </span>
                <span className="text-slate-600">
                  You pay <span className="font-semibold text-slate-900">{currencySymbol} {money(totals.cost)}</span>
                </span>
                {canPrice && totals.sales > 0 && (
                  <span className={cn("font-semibold", totals.profit >= 0 ? "text-emerald-700" : "text-brand-red-dark")}>
                    {totals.profit >= 0 ? "Profit" : "Loss"} {currencySymbol} {money(Math.abs(totals.profit))}
                    {Number.isFinite(totals.margin) && ` (${Math.round(totals.margin)}%)`}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {step === 1 ? (
              <Link href="/shipments" className="btn-secondary">
                Cancel
              </Link>
            ) : (
              <button type="button" className="btn-secondary" onClick={() => go((step - 1) as 1 | 2)}>
                <ArrowLeft size={16} /> Back
              </button>
            )}
            {step < 3 ? (
              <button type="button" className="btn-primary min-h-11 px-5" onClick={next}>
                {step === 1 ? "Packing list" : "Review"} <ArrowRight size={16} />
              </button>
            ) : (
              <SubmitButton pendingLabel="Sealing…" className="btn-primary min-h-11 px-5" disabled={!checked || Boolean(problem)}>
                <span className="inline-flex items-center gap-2">
                  <PackageCheck size={16} /> Seal and send to the shop <Truck size={16} />
                </span>
              </SubmitButton>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
