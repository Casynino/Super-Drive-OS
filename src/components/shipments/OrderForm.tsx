"use client";

import Link from "next/link";
import { useActionState, useMemo, useRef, useState, useTransition } from "react";
import { ChevronDown, ImageOff, ImagePlus, Minus, PackagePlus, Plus, Save, Search, Send, Trash2, X } from "lucide-react";
import { Alert } from "@/components/ui";
import { SubmitButton } from "@/components/FormBits";
import type { ActionState } from "@/lib/action";
import { defaultUnitId, type LocationOption, type PickerProduct } from "@/lib/inventory/types";
import { cn } from "@/lib/utils";

/**
 * The order list (Nino 2026-11-10: "no steps, the boss just makes a list of what he bought; pick products nicely, add a new one easily with its price;
 * he can save it, come back later and finish, or send it to the shop"). One screen: pick products, set how many and the buying price (and the selling
 * price if it should change), then Send. "Save draft" keeps the list for later; nothing is announced until Send.
 */

type Option = { id: string; name: string };
type Line = {
  productId: string;
  unitId: string;
  /** how many, in `unitId` */
  qty: string;
  /** buying price per `unitId`, landed (goods, shipping and duties together) */
  buy: string;
  /** selling price per `unitId`; the product's price today when it is not changed */
  sell: string;
};
export type OrderDraftState = {
  v: 1;
  lines: Line[];
  supplierText: string;
  cargoName: string;
  expectedDate: string;
  locationId: string;
  notes: string;
};
type SaveResult = { ok: true; id: string; savedAt: string } | { ok: false; error: string };
type Props = {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  createProduct: (fd: FormData) => Promise<{ ok: true; product: PickerProduct } | { ok: false; error: string }>;
  saveDraft: (input: { id: string | null; state: unknown }) => Promise<SaveResult>;
  products: PickerProduct[];
  locations: LocationOption[];
  suppliers: Option[];
  canAddSupplier: boolean;
  categories: Option[];
  brands: Option[];
  defaultCategoryId: string;
  cargoNames: string[];
  canPrice: boolean;
  currencySymbol: string;
  submissionKey: string;
  draft: { id: string; state: OrderDraftState; savedAt: string } | null;
};

const initial: ActionState = {};
const num = (s: string) => (s.trim() === "" ? NaN : Number(s.replace(/,/g, "")));
const money = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(n));
const trim = (n: number, dp = 2) => String(Number(n.toFixed(dp)));
const timeText = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

const unitOf = (p: PickerProduct | undefined, unitId: string) => p?.units.find((u) => u.id === unitId) ?? p?.units[0];
/** today's selling price of the product per unit (the carton's exact price for a pack), as text; empty when it has none */
function currentSell(p: PickerProduct, unitId: string): string {
  const u = unitOf(p, unitId);
  if (!u) return "";
  const f = Number(u.factor);
  if (f > 1) return p.packPrice && Number(p.packPrice) > 0 ? trim(Number(p.packPrice)) : p.sellingPrice && Number(p.sellingPrice) > 0 ? trim(Number(p.sellingPrice) * f) : "";
  return p.sellingPrice && Number(p.sellingPrice) > 0 ? trim(Number(p.sellingPrice)) : "";
}
const newLine = (p: PickerProduct): Line => {
  const unitId = defaultUnitId(p, "purchase");
  return { productId: p.id, unitId, qty: "1", buy: "", sell: currentSell(p, unitId) };
};

export default function OrderForm({ action, createProduct, saveDraft, products: initialProducts, locations, suppliers, canAddSupplier, categories, brands, defaultCategoryId, cargoNames, canPrice, currencySymbol, submissionKey: key, draft }: Props) {
  const [state, formAction] = useActionState(action, initial);
  const fe = state.fieldErrors ?? {};
  const [submissionKey] = useState(key);
  const [products, setProducts] = useState(initialProducts);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // a draft may mention a product that is gone or switched off since: those lines are dropped (and said so)
  const start = draft?.state;
  const keptLines = (start?.lines ?? []).filter((l) => initialProducts.some((p) => p.id === l.productId));
  const droppedFromDraft = (start?.lines.length ?? 0) - keptLines.length;
  const [lines, setLines] = useState<Line[]>(keptLines);
  const [supplierText, setSupplierText] = useState(start?.supplierText ?? "");
  const [cargoName, setCargoName] = useState(start?.cargoName ?? "");
  const [expectedDate, setExpectedDate] = useState(start?.expectedDate ?? "");
  const [locationId, setLocationId] = useState(start?.locationId && locations.some((l) => l.id === start.locationId) ? start.locationId : (locations.find((l) => l.isDefault)?.id ?? locations[0]?.id ?? ""));
  const [notes, setNotes] = useState(start?.notes ?? "");
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(draft?.id ?? null);
  const [savedAt, setSavedAt] = useState<string | null>(draft?.savedAt ?? null);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [nudge, setNudge] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  const touch = () => {
    setDirty(true);
    setNudge(null);
  };
  const change = (fn: (all: Line[]) => Line[]) => {
    setLines(fn);
    touch();
  };
  const patch = (i: number, p: Partial<Line>) => change((all) => all.map((l, idx) => (idx === i ? { ...l, ...p } : l)));

  const add = (p: PickerProduct) => {
    if (lines.some((l) => l.productId === p.id)) return;
    change((all) => [...all, newLine(p)]);
  };

  // figures per line and for the whole order
  const figures = (l: Line) => {
    const p = byId.get(l.productId);
    const u = unitOf(p, l.unitId);
    const qty = num(l.qty);
    const buy = num(l.buy);
    const sell = num(l.sell);
    const total = Number.isFinite(qty) && Number.isFinite(buy) ? qty * buy : NaN;
    const profitEach = Number.isFinite(buy) && Number.isFinite(sell) && buy > 0 && sell > 0 ? sell - buy : NaN;
    return { p, u, qty, buy, sell, total, profitEach, margin: Number.isFinite(profitEach) ? (profitEach / num(l.sell)) * 100 : NaN, factor: u ? Number(u.factor) : 1 };
  };
  const totals = useMemo(() => {
    let cost = 0;
    let profit = 0;
    let priced = 0;
    for (const l of lines) {
      const f = figures(l);
      if (Number.isFinite(f.total)) cost += f.total;
      if (Number.isFinite(f.profitEach) && Number.isFinite(f.qty)) {
        profit += f.profitEach * f.qty;
        priced += f.qty * f.sell;
      }
    }
    return { cost, profit, margin: priced > 0 ? (profit / priced) * 100 : NaN, hasProfit: priced > 0 };
  }, [lines, byId]); // eslint-disable-line react-hooks/exhaustive-deps

  const problem = useMemo(() => {
    if (lines.length === 0) return "Pick at least one product.";
    for (const l of lines) {
      const f = figures(l);
      const name = f.p?.name ?? "each product";
      if (!Number.isFinite(f.qty) || f.qty <= 0) return `Say how many ${name} you bought.`;
      if (!Number.isFinite(f.buy) || f.buy <= 0) return `Enter what ${name} cost you.`;
    }
    return null;
  }, [lines, byId]); // eslint-disable-line react-hooks/exhaustive-deps

  // a supplier name typed here is either one already on the list or a new supplier that is added when the order is sent
  const typedSupplier = supplierText.trim();
  const matchedSupplier = typedSupplier ? suppliers.find((s) => s.name.toLowerCase() === typedSupplier.toLowerCase()) : undefined;
  const newSupplierName = typedSupplier && !matchedSupplier ? typedSupplier : null;

  const payload = JSON.stringify({
    supplierId: matchedSupplier?.id ?? null,
    newSupplierName,
    reference: null,
    cargoName: cargoName.trim() || null,
    expectedDate: expectedDate || null,
    locationId,
    notes: notes.trim() || null,
    lines: lines.map((l) => {
      const f = figures(l);
      const total = Number.isFinite(f.total) ? Math.round(f.total) : 0;
      const price = canPrice && Number.isFinite(f.sell) && f.sell > 0 ? (f.factor > 1 ? { packSellingPrice: trim(f.sell) } : { sellingPrice: trim(f.sell) }) : {};
      return { productId: l.productId, unitId: l.unitId, quantity: l.qty.trim(), totalCost: String(total), ...price };
    }),
    submissionKey,
    draftId,
  });

  const draftState = (): OrderDraftState => ({ v: 1, lines, supplierText, cargoName, expectedDate, locationId, notes });
  const save = () => {
    setSaveError(null);
    startSave(async () => {
      const r = await saveDraft({ id: draftId, state: draftState() });
      if (!r.ok) return setSaveError(r.error);
      setDraftId(r.id);
      setSavedAt(r.savedAt);
      setDirty(false);
      window.history.replaceState(null, "", `/shipments/new?draft=${r.id}`);
    });
  };

  // changing the unit keeps the money the same: a carton price becomes a piece price and back
  const changeUnit = (i: number, unitId: string) => {
    const l = lines[i]!;
    const p = byId.get(l.productId);
    const from = Number(unitOf(p, l.unitId)?.factor ?? 1);
    const to = Number(unitOf(p, unitId)?.factor ?? 1);
    const conv = (s: string) => (Number.isFinite(num(s)) && from > 0 ? trim((num(s) / from) * to) : s);
    patch(i, { unitId, buy: conv(l.buy), sell: p ? currentSell(p, unitId) : l.sell });
  };

  // tiles: what matches the search and is not on the list yet
  const q = query.trim().toLowerCase();
  const matches = products.filter((p) => !lines.some((l) => l.productId === p.id) && (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)));
  const LIMIT = 24;
  const PHONE_FIRST = 6; // a phone shows the first few and a Show all button, so the list below stays close
  const shown = showAll || q ? matches : matches.slice(0, LIMIT);
  const oneLocation = locations.length === 1;
  const detailsFilled = Boolean(supplierText.trim() || cargoName.trim() || expectedDate || notes.trim());

  return (
    <form
      action={formAction}
      noValidate
      className="pb-40 lg:pb-28"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
      }}
    >
      <input type="hidden" name="payloadJson" value={payload} />
      {state.error && (
        <div className="mb-4">
          <Alert>{state.error}</Alert>
        </div>
      )}
      {droppedFromDraft > 0 && (
        <div className="mb-4">
          <Alert>{droppedFromDraft === 1 ? "One product in this draft is not in the system any more, so it was left out." : `${droppedFromDraft} products in this draft are not in the system any more, so they were left out.`}</Alert>
        </div>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* ───────── pick products ───────── */}
        <section className="card card-pad min-w-0">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-900">What did you buy?</h2>
            {lines.length > 0 && (
              <a href="#order-list" className="text-sm font-medium text-navy-700 xl:hidden">
                Your list ({lines.length}) ↓
              </a>
            )}
          </div>

          <div className="relative mt-3">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
            <input className="input h-11 pl-10" placeholder="Search your products" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" aria-label="Search your products" />
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3 2xl:grid-cols-4">
            <button type="button" onClick={() => setNewOpen((o) => !o)} aria-expanded={newOpen} className={cn("flex min-h-14 items-center gap-2.5 rounded-xl border border-dashed px-3 py-2 text-left text-sm font-medium transition-colors", newOpen ? "border-navy-500 bg-navy-50 text-navy-800" : "border-slate-300 text-slate-700 hover:border-navy-400 hover:bg-slate-50")}>
              <PackagePlus size={18} className="shrink-0 text-navy-600" />
              New product
            </button>
            {shown.map((p, idx) => (
              <button key={p.id} type="button" onClick={() => add(p)} className={cn("flex min-h-14 items-center gap-2.5 rounded-xl border border-line bg-white px-2.5 py-2 text-left transition-colors hover:border-navy-300 hover:bg-slate-50", !showAll && !q && idx >= PHONE_FIRST && "max-sm:hidden")}>
                <Thumb p={p} className="size-10" />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[13px] font-medium leading-snug text-slate-900">{p.name}</span>
                  {packNote(p) && <span className="block truncate text-[11px] text-slate-500">{packNote(p)}</span>}
                </span>
                <Plus size={16} className="shrink-0 text-slate-400" aria-hidden />
              </button>
            ))}
          </div>
          {matches.length === 0 && (
            <p className="mt-3 text-sm text-slate-500">{products.length === 0 ? "There are no products yet. Press New product to add the first one." : q ? "Nothing matches. Press New product to add it." : "Every product is already on your list."}</p>
          )}
          {!showAll && !q && (matches.length > LIMIT || matches.length > PHONE_FIRST) && (
            <button type="button" className={cn("mt-3 text-sm font-medium text-navy-700", matches.length <= LIMIT && "sm:hidden")} onClick={() => setShowAll(true)}>
              Show all {matches.length} products
            </button>
          )}

          {newOpen && (
            <NewProduct
              categories={categories}
              brands={brands}
              defaultCategoryId={defaultCategoryId}
              canPrice={canPrice}
              currencySymbol={currencySymbol}
              create={createProduct}
              onClose={() => setNewOpen(false)}
              onCreated={(p) => {
                setProducts((all) => [...all, p]);
                change((all) => [...all, newLine(p)]);
                setNewOpen(false);
              }}
            />
          )}
        </section>

        {/* ───────── the list ───────── */}
        <section id="order-list" className="card min-w-0 scroll-mt-4 xl:sticky xl:top-6">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
            <h2 className="text-base font-semibold text-slate-900">Your list</h2>
            <span className="text-sm text-slate-500">{lines.length === 0 ? "Nothing yet" : `${lines.length} product${lines.length === 1 ? "" : "s"}`}</span>
          </div>

          {lines.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">
              Tap a product to add it here.
              {fe.lines && <span className="mt-1 block font-medium text-brand-red-dark">{fe.lines}</span>}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {lines.map((l, i) => {
                const f = figures(l);
                const p = f.p;
                const err = fe[`line.${i}`];
                const unitName = f.u?.name ?? "";
                const unitLabel = f.factor > 1 ? "carton" : (f.u?.symbol ?? "piece").toLowerCase();
                const toneUp = Number.isFinite(f.profitEach) && f.profitEach >= 0;
                return (
                  <li key={l.productId} className={cn("px-4 py-3.5 sm:px-5", err && "bg-brand-red-soft/40")}>
                    <div className="flex items-start gap-3">
                      {p ? <Thumb p={p} className="size-12" /> : <div className="size-12 rounded-xl bg-slate-100" />}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-semibold text-slate-900">{p?.name ?? "Unknown product"}</p>
                        {p && p.units.length > 1 && (
                          <div className="mt-1 inline-flex overflow-hidden rounded-lg border border-line text-xs">
                            {p.units.map((u) => (
                              <button key={u.id} type="button" onClick={() => changeUnit(i, u.id)} className={cn("px-2.5 py-1 font-medium", u.id === l.unitId ? "bg-navy-700 text-white" : "bg-white text-slate-600 hover:bg-slate-50")} aria-pressed={u.id === l.unitId}>
                                {u.symbol}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <button type="button" onClick={() => change((all) => all.filter((_, idx) => idx !== i))} className="grid size-9 shrink-0 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-brand-red-dark" aria-label={`Remove ${p?.name ?? "product"}`}>
                        <Trash2 size={16} />
                      </button>
                    </div>

                    <div className={cn("mt-3 grid gap-3", canPrice ? "grid-cols-2 sm:grid-cols-[auto_1fr_1fr]" : "grid-cols-2 sm:grid-cols-[auto_1fr]")}>
                      <div className="col-span-2 sm:col-span-1">
                        <label className="label" htmlFor={`q-${i}`}>
                          How many {unitName.toLowerCase() === "carton" || f.factor > 1 ? "cartons" : "pieces"}
                        </label>
                        <div className="flex h-10 items-center overflow-hidden rounded-lg border border-line bg-white">
                          <button type="button" className="grid h-full w-10 place-items-center text-slate-500 hover:bg-slate-50" aria-label="One less" onClick={() => patch(i, { qty: String(Math.max(1, (Number.isFinite(f.qty) ? Math.round(f.qty) : 1) - 1)) })}>
                            <Minus size={15} />
                          </button>
                          <input id={`q-${i}`} className="h-full w-16 border-x border-line bg-transparent text-center text-[15px] font-semibold text-slate-900 outline-none" inputMode="decimal" value={l.qty} onChange={(e) => patch(i, { qty: e.target.value })} />
                          <button type="button" className="grid h-full w-10 place-items-center text-slate-500 hover:bg-slate-50" aria-label="One more" onClick={() => patch(i, { qty: String((Number.isFinite(f.qty) ? Math.round(f.qty) : 0) + 1) })}>
                            <Plus size={15} />
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="label" htmlFor={`b-${i}`}>
                          You paid, per {unitLabel} ({currencySymbol})
                        </label>
                        <input id={`b-${i}`} className="input h-10" inputMode="decimal" placeholder="0" value={l.buy} onChange={(e) => patch(i, { buy: e.target.value })} />
                      </div>
                      {canPrice && (
                        <div>
                          <label className="label" htmlFor={`s-${i}`}>
                            Sell at, per {unitLabel} ({currencySymbol})
                          </label>
                          <input id={`s-${i}`} className="input h-10" inputMode="decimal" placeholder="Not set yet" value={l.sell} onChange={(e) => patch(i, { sell: e.target.value })} />
                        </div>
                      )}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
                      <span className="text-slate-500">
                        {Number.isFinite(f.total) ? (
                          <>
                            Line total <span className="font-semibold text-slate-800">{currencySymbol} {money(f.total)}</span>
                          </>
                        ) : (
                          "Enter how many and what you paid"
                        )}
                        {f.factor > 1 && Number.isFinite(f.qty) && f.qty > 0 && <> · {trim(f.qty * f.factor, 3)} pieces</>}
                      </span>
                      {canPrice && Number.isFinite(f.profitEach) && (
                        <span className={cn("font-medium", toneUp ? "text-emerald-700" : "text-brand-red-dark")}>
                          {toneUp ? "Profit" : "Loss"} {currencySymbol} {money(Math.abs(f.profitEach))} per {unitLabel} · {Math.round(f.margin)}%
                        </span>
                      )}
                    </div>
                    {err && <p className="field-error mt-1">{err}</p>}
                  </li>
                );
              })}
            </ul>
          )}

          {/* ───────── details (optional) ───────── */}
          <details className="group border-t border-line" open={detailsFilled || Boolean(fe.supplierName || fe.supplierId || fe.locationId)}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 text-sm font-medium text-slate-800 sm:px-5 [&::-webkit-details-marker]:hidden">
              <span>
                Supplier, cargo and arrival date <span className="font-normal text-slate-500">(optional)</span>
              </span>
              <ChevronDown size={16} className="text-slate-400 transition-transform group-open:rotate-180" />
            </summary>
            <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2 sm:px-5">
              <div>
                <label className="label" htmlFor="o-supplier">
                  Supplier
                </label>
                {canAddSupplier ? (
                  <>
                    <input id="o-supplier" className={cn("input", (fe.supplierName ?? fe.supplierId) && "border-brand-red")} list="o-supplier-names" value={supplierText} onChange={(e) => { setSupplierText(e.target.value); touch(); }} placeholder="Pick one or type a new name" autoComplete="off" maxLength={120} />
                    <datalist id="o-supplier-names">
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.name} />
                      ))}
                    </datalist>
                    {newSupplierName && <p className="hint">New supplier: it is added when you send the order.</p>}
                  </>
                ) : (
                  <select id="o-supplier" className="input" value={matchedSupplier?.name ?? ""} onChange={(e) => { setSupplierText(e.target.value); touch(); }}>
                    <option value="">No supplier</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.name}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}
                {(fe.supplierName ?? fe.supplierId) && <p className="field-error">{fe.supplierName ?? fe.supplierId}</p>}
              </div>
              <div>
                <label className="label" htmlFor="o-cargo">
                  Cargo company
                </label>
                <input id="o-cargo" className="input" list="o-cargo-names" value={cargoName} onChange={(e) => { setCargoName(e.target.value); touch(); }} placeholder="Who brings it" autoComplete="off" />
                <datalist id="o-cargo-names">
                  {cargoNames.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="label" htmlFor="o-date">
                  Expected arrival
                </label>
                <input id="o-date" type="date" className="input" value={expectedDate} onChange={(e) => { setExpectedDate(e.target.value); touch(); }} />
              </div>
              {oneLocation ? (
                <div>
                  <p className="label">Deliver to</p>
                  <p className="flex min-h-10 items-center rounded-lg bg-slate-50 px-3 text-sm font-medium text-slate-700">{locations[0]!.name}</p>
                </div>
              ) : (
                <div>
                  <label className="label" htmlFor="o-loc">
                    Deliver to
                  </label>
                  <select id="o-loc" className={cn("input", fe.locationId && "border-brand-red")} value={locationId} onChange={(e) => { setLocationId(e.target.value); touch(); }}>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                  {fe.locationId && <p className="field-error">{fe.locationId}</p>}
                </div>
              )}
              <div className="sm:col-span-2">
                <label className="label" htmlFor="o-notes">
                  Note for the shop
                </label>
                <textarea id="o-notes" rows={2} className="input" value={notes} onChange={(e) => { setNotes(e.target.value); touch(); }} placeholder="e.g. 2 trucks, the second one comes Friday" />
              </div>
            </div>
          </details>
        </section>
      </div>

      {/* ───────── bottom bar ───────── */}
      <div className="fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-white/95 px-4 py-3 shadow-[0_-4px_12px_rgba(15,27,45,0.08)] backdrop-blur lg:bottom-0 lg:left-[15.5rem]">
        <div className="mx-auto flex max-w-[1920px] flex-wrap items-center justify-between gap-x-6 gap-y-2 lg:px-4">
          <div className="min-w-0 text-sm">
            {nudge ? (
              <p role="alert" className="font-medium text-brand-red-dark">
                {nudge}
              </p>
            ) : saveError ? (
              <p role="alert" className="font-medium text-brand-red-dark">
                {saveError}
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-0.5">
                <span className="text-slate-600">
                  You pay <span className="font-semibold text-slate-900">{currencySymbol} {money(totals.cost)}</span>
                </span>
                {canPrice && totals.hasProfit && (
                  <span className={cn("font-semibold", totals.profit >= 0 ? "text-emerald-700" : "text-brand-red-dark")}>
                    {totals.profit >= 0 ? "Profit" : "Loss"} {currencySymbol} {money(Math.abs(totals.profit))}
                    {Number.isFinite(totals.margin) && ` (${Math.round(totals.margin)}%)`}
                  </span>
                )}
                <span className="text-xs text-slate-500">{dirty ? "Not saved yet" : savedAt ? `Draft saved at ${timeText(savedAt)}` : ""}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link href="/shipments" className="btn-secondary hidden sm:inline-flex">
              Close
            </Link>
            <button type="button" className="btn-secondary min-h-11" onClick={save} disabled={saving || lines.length === 0}>
              <Save size={16} /> {saving ? "Saving…" : "Save draft"}
            </button>
            {problem ? (
              <button type="button" className="btn-primary min-h-11 px-5" onClick={() => setNudge(problem)}>
                <Send size={16} /> Send to the shop
              </button>
            ) : (
              <SubmitButton pendingLabel="Sending…" className="btn-primary min-h-11 px-5">
                <span className="inline-flex items-center gap-2">
                  <Send size={16} /> Send to the shop
                </span>
              </SubmitButton>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}

function packNote(p: PickerProduct) {
  const pack = p.units.find((u) => Number(u.factor) > 1);
  return pack ? `${trim(Number(pack.factor), 3)} per ${pack.name.toLowerCase()}` : "";
}

function Thumb({ p, className }: { p: PickerProduct; className?: string }) {
  return (
    <span className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-white", className)}>
      {p.imageV ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/product-image/${p.id}?size=thumb&v=${p.imageV}`} alt="" className="h-full w-full object-contain" />
      ) : (
        <ImageOff size={16} className="text-slate-300" />
      )}
    </span>
  );
}

/** A product that is not in the system yet: a name, how many in a carton, its picture and price; everything else is filled in for you. */
function NewProduct({ categories, brands, defaultCategoryId, canPrice, currencySymbol, create, onCreated, onClose }: { categories: Option[]; brands: Option[]; defaultCategoryId: string; canPrice: boolean; currencySymbol: string; create: Props["createProduct"]; onCreated: (p: PickerProduct) => void; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, startCreate] = useTransition();
  const box = useRef<HTMLDivElement>(null);

  const submit = () => {
    // the fields are read by hand: a <form> cannot sit inside the order form, and these fields must not be posted with the order
    const fd = new FormData();
    box.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-name]").forEach((el) => {
      const name = el.dataset.name!;
      if (el instanceof HTMLInputElement && el.type === "file") {
        if (el.files?.[0]) fd.append(name, el.files[0]);
      } else fd.append(name, el.value);
    });
    startCreate(async () => {
      setError(null);
      const r = await create(fd);
      if (!r.ok) return setError(r.error);
      onCreated(r.product); // the panel closes, so the next new product starts empty
    });
  };

  return (
    <div className="mt-4 rounded-xl border border-navy-200 bg-navy-50/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">New product</h3>
        <button type="button" className="grid size-7 place-items-center rounded-full text-slate-400 hover:bg-white hover:text-slate-700" onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>
      </div>
      <div ref={box} className="grid gap-3 sm:grid-cols-[96px_1fr]">
        <label className="flex size-24 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-white text-xs text-slate-400 hover:border-navy-400">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Preview" className="h-full w-full object-contain" />
          ) : (
            <span className="flex flex-col items-center gap-1">
              <ImagePlus size={22} />
              Picture
            </span>
          )}
          <input type="file" data-name="image" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; setPreview(f ? URL.createObjectURL(f) : null); }} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="np-name">
              Name
            </label>
            <input id="np-name" data-name="name" className="input" placeholder="e.g. Total 10W-40 4L" autoComplete="off" />
          </div>
          <div>
            <label className="label" htmlFor="np-ctn">
              Pieces in a carton
            </label>
            <input id="np-ctn" data-name="perCarton" className="input" inputMode="numeric" placeholder="e.g. 12" />
          </div>
          {canPrice && (
            <div>
              <label className="label" htmlFor="np-price">
                Sell at, per carton ({currencySymbol})
              </label>
              <input id="np-price" data-name="cartonPrice" className="input" inputMode="decimal" placeholder="Set later" />
            </div>
          )}
          <details className="sm:col-span-2">
            <summary className="cursor-pointer text-xs font-medium text-slate-600">Category and brand</summary>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <select data-name="categoryId" className="input" defaultValue={defaultCategoryId} aria-label="Category">
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select data-name="brandId" className="input" defaultValue="" aria-label="Brand">
                <option value="">No brand</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          </details>
        </div>
      </div>
      {error && <p className="field-error mt-2">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" className="btn-primary" onClick={submit} disabled={pending}>
          {pending ? "Adding…" : "Add to my list"}
        </button>
        <button type="button" className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
