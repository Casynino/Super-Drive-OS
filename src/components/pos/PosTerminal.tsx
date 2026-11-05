"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { Minus, Plus, Trash2, UserPlus, X } from "lucide-react";
import { Alert } from "@/components/ui";
import { SubmitButton } from "@/components/FormBits";
import ProductPicker from "@/components/inventory/ProductPicker";
import type { ActionState } from "@/lib/action";
import type { LocationOption } from "@/lib/inventory/types";
import { PAYMENT_METHODS, type CartLine, type PosCustomer, type PosProduct } from "@/lib/sales/types";
import { cn } from "@/lib/utils";

type Props = {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  quickAddCustomer: (input: { name: string; phone: string; type: string }) => Promise<{ ok: true; customer: { id: string; name: string; phone: string | null; type: string } } | { ok: false; error: string }>;
  products: PosProduct[];
  locations: LocationOption[];
  stockByLocation: Record<string, Record<string, string>>;
  customers: PosCustomer[];
  submissionKey: string;
  currency: { code: string; symbol: string; decimals: number };
  perms: { credit: boolean; discount: boolean; addCustomer: boolean; creditException: boolean };
};

const initial: ActionState = {};
const WHOLESALE = ["WHOLESALE", "DISTRIBUTOR"];
const TYPE_OPTIONS = [
  ["RETAIL", "Retail"],
  ["WHOLESALE", "Wholesale"],
  ["DISTRIBUTOR", "Distributor"],
  ["BUSINESS", "Business"],
  ["OTHER", "Other"],
] as const;
const trim = (n: number) => String(Number(n.toFixed(3)));

export default function PosTerminal({ action, quickAddCustomer, products, locations, stockByLocation, customers: initialCustomers, submissionKey: key, currency, perms }: Props) {
  const [state, formAction] = useActionState(action, initial);
  const fe = state.fieldErrors ?? {};
  const [submissionKey] = useState(key); // one key per page visit: a double click cannot create two sales

  const [locationId, setLocationId] = useState(locations.find((l) => l.isDefault)?.id ?? locations[0]!.id);
  const [customers, setCustomers] = useState(initialCustomers);
  const [customer, setCustomer] = useState<PosCustomer | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [mode, setMode] = useState<"FULL" | "CREDIT" | "PART">("FULL");
  const [method, setMethod] = useState("CASH");
  const [partAmount, setPartAmount] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [exception, setException] = useState(false);
  const [exceptionReason, setExceptionReason] = useState("");

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const nf = useMemo(() => new Intl.NumberFormat("en-US", { minimumFractionDigits: currency.decimals, maximumFractionDigits: currency.decimals }), [currency.decimals]);
  const fmt = (n: number) => `${currency.symbol} ${nf.format(n)}`;
  const round = (n: number) => Number(n.toFixed(currency.decimals));

  const wholesale = customer ? WHOLESALE.includes(customer.type) : false;

  // ── cart maths (display only; the server recalculates everything from the database) ──
  const rows = cart.map((l) => {
    const p = byId.get(l.productId)!;
    const unit = p.units.find((u) => u.id === l.unitId) ?? p.units[0]!;
    const list = Number(wholesale ? unit.wholesale : unit.retail);
    const price = l.price.trim() === "" ? list : Number(l.price);
    const qty = Number(l.quantity);
    const valid = Number.isFinite(qty) && qty > 0 && Number.isFinite(price) && price >= 0 && list > 0;
    return { l, p, unit, list, price, qty, valid, lineList: valid ? round(qty * list) : 0, lineTotal: valid ? round(qty * price) : 0, baseQty: valid ? qty * Number(unit.factor) : 0 };
  });
  const subtotal = rows.reduce((s, r) => s + r.lineList, 0);
  const total = rows.reduce((s, r) => s + r.lineTotal, 0);
  const discount = subtotal - total;

  const baseUsed = new Map<string, number>();
  for (const r of rows) baseUsed.set(r.p.id, (baseUsed.get(r.p.id) ?? 0) + r.baseQty);
  const available = (productId: string) => Number(stockByLocation[locationId]?.[productId] ?? 0);

  const partNum = Number(partAmount);
  const paidNow = mode === "FULL" ? total : mode === "CREDIT" ? 0 : Number.isFinite(partNum) ? partNum : 0;
  const onCredit = Math.max(total - paidNow, 0);
  const owes = Number(customer?.outstanding ?? 0);
  const limit = Number(customer?.creditLimit ?? 0);
  const overLimit = onCredit > 0 && customer?.creditLimit !== undefined && owes + onCredit > limit;

  const problems: string[] = [];
  if (cart.length === 0) problems.push("Add a product");
  else if (rows.some((r) => !r.valid)) problems.push("Fix the quantities or prices");
  if (mode !== "FULL" && !customer) problems.push("Choose a customer");
  if (mode === "PART" && !(partNum > 0 && partNum < total)) problems.push("Enter a part payment below the total");
  if (overLimit && perms.creditException && exception && exceptionReason.trim().length < 5) problems.push("Give a reason for the exception");
  const canSubmit = problems.length === 0;

  const payload = JSON.stringify({
    customerId: customer?.id ?? null,
    locationId,
    mode,
    method: mode === "CREDIT" ? null : method,
    partAmount: mode === "PART" ? partAmount : null,
    reference: reference.trim() || null,
    notes: notes.trim() || null,
    lines: cart.map((l) => ({ productId: l.productId, unitId: l.unitId, quantity: l.quantity, unitPrice: l.price })),
    creditException: overLimit && perms.creditException && exception ? { reason: exceptionReason.trim() } : null,
    submissionKey,
  });

  // ── cart actions ──
  const addProduct = (p: PosProduct) =>
    setCart((c) => {
      const i = c.findIndex((l) => l.productId === p.id && l.unitId === p.baseUnitId);
      if (i >= 0) return c.map((l, idx) => (idx === i ? { ...l, quantity: String(Number(l.quantity || 0) + 1) } : l));
      return [...c, { productId: p.id, unitId: p.baseUnitId, quantity: "1", price: "" }];
    });
  const patch = (i: number, p: Partial<CartLine>) => setCart((c) => c.map((l, idx) => (idx === i ? { ...l, ...p } : l)));
  const step = (i: number, delta: number) => setCart((c) => c.map((l, idx) => (idx === i ? { ...l, quantity: String(Math.max(Number(l.quantity || 0) + delta, 0)) } : l)));
  const addOtherUnit = (i: number) =>
    setCart((c) => {
      const l = c[i]!;
      const p = byId.get(l.productId)!;
      const free = p.units.find((u) => !c.some((x) => x.productId === l.productId && x.unitId === u.id));
      return free ? [...c, { productId: l.productId, unitId: free.id, quantity: "1", price: "" }] : c;
    });

  // ── customer search / quick add ──
  const [custQ, setCustQ] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [newCust, setNewCust] = useState({ name: "", phone: "", type: "RETAIL" });
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, startAdd] = useTransition();
  const matches = custQ.trim() ? customers.filter((c) => c.name.toLowerCase().includes(custQ.trim().toLowerCase()) || (c.phone ?? "").includes(custQ.trim())).slice(0, 6) : [];
  const saveNewCustomer = () =>
    startAdd(async () => {
      setAddError(null);
      const r = await quickAddCustomer(newCust);
      if (!r.ok) return setAddError(r.error);
      const c: PosCustomer = { ...r.customer, ...(perms.credit ? { creditLimit: "0", outstanding: "0" } : {}) };
      setCustomers((all) => [...all, c]);
      setCustomer(c);
      setAddOpen(false);
      setNewCust({ name: "", phone: "", type: "RETAIL" });
    });

  return (
    <form
      action={formAction}
      className="pb-28 xl:pb-0"
      noValidate
      onKeyDown={(e) => {
        // Pressing Enter in a field (quantity, price, note…) must never complete the sale by accident.
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
      }}
    >
      <input type="hidden" name="payloadJson" value={payload} />
      {state.error && (
        <div className="mb-4">
          <Alert>{state.error}</Alert>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_390px]">
        {/* ───────── Left: products & cart ───────── */}
        <section className="space-y-4">
          <div className="card card-pad">
            <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
              <div>
                <label className="label">Add product</label>
                <ProductPicker products={products} onPick={(p) => addProduct(byId.get(p.id)!)} autoFocus placeholder="Search name or scan barcode…" />
              </div>
              {locations.length > 1 && (
                <div>
                  <label className="label" htmlFor="pos-location">
                    Sell from
                  </label>
                  <select id="pos-location" className="input" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          <div className="card overflow-hidden">
            <h2 className="border-b border-line px-4 py-3 text-base font-semibold text-slate-900">Cart {rows.length > 0 && <span className="text-sm font-normal text-slate-500">({rows.length})</span>}</h2>
            {rows.length === 0 ? (
              <p className="px-4 py-12 text-center text-sm text-slate-500">The cart is empty. Search for a product above.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {rows.map((r, i) => {
                  const err = fe[`line.${i}`];
                  const free = available(r.p.id);
                  const used = baseUsed.get(r.p.id) ?? 0;
                  const over = used > free;
                  const takenUnits = new Set(cart.filter((x, idx) => x.productId === r.l.productId && idx !== i).map((x) => x.unitId));
                  return (
                    <li key={`${r.l.productId}:${r.l.unitId}`} className={cn("px-4 py-3", (err || over) && "bg-brand-red-soft/40")}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-900">{r.p.name}</p>
                          <p className={cn("text-xs", over ? "font-medium text-brand-red-dark" : "text-slate-500")}>
                            {over ? `Only ${trim(free)} ${r.p.units[0]!.symbol} in stock here` : `${trim(free)} ${r.p.units[0]!.symbol} in stock`}
                            {r.p.units.length > 1 && r.baseQty > 0 && r.unit.id !== r.p.baseUnitId && ` · uses ${trim(r.baseQty)} ${r.p.units[0]!.symbol}`}
                          </p>
                        </div>
                        <button type="button" className="btn-secondary btn-sm shrink-0" onClick={() => setCart((c) => c.filter((_, idx) => idx !== i))} aria-label={`Remove ${r.p.name}`}>
                          <Trash2 size={15} />
                        </button>
                      </div>

                      <div className="mt-2.5 grid grid-cols-2 items-end gap-3 sm:grid-cols-[130px_150px_1fr_auto]">
                        <div>
                          <label className="label" htmlFor={`pos-unit-${i}`}>
                            Unit
                          </label>
                          <select id={`pos-unit-${i}`} className="input" value={r.l.unitId} onChange={(e) => patch(i, { unitId: e.target.value, price: "" })} disabled={r.p.units.length === 1}>
                            {r.p.units.filter((u) => u.id === r.l.unitId || !takenUnits.has(u.id)).map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="label" htmlFor={`pos-qty-${i}`}>
                            Quantity
                          </label>
                          <div className="flex items-center gap-1.5">
                            <button type="button" className="btn-secondary btn-sm px-2" onClick={() => step(i, -1)} aria-label="Decrease quantity">
                              <Minus size={15} />
                            </button>
                            <input id={`pos-qty-${i}`} className="input min-w-0 text-center" inputMode="decimal" value={r.l.quantity} onChange={(e) => patch(i, { quantity: e.target.value })} />
                            <button type="button" className="btn-secondary btn-sm px-2" onClick={() => step(i, 1)} aria-label="Increase quantity">
                              <Plus size={15} />
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className="label" htmlFor={`pos-price-${i}`}>
                            Price per {r.unit.symbol}
                          </label>
                          {perms.discount ? (
                            <input id={`pos-price-${i}`} className="input" inputMode="decimal" value={r.l.price} placeholder={nf.format(r.list)} onChange={(e) => patch(i, { price: e.target.value })} />
                          ) : (
                            <p className="flex min-h-9 items-center text-sm text-slate-900">{r.list > 0 ? fmt(r.list) : <span className="text-brand-red-dark">No price set</span>}</p>
                          )}
                        </div>
                        <div className="col-span-2 text-right sm:col-span-1 sm:min-w-28">
                          <p className="text-xs text-slate-500">Line total</p>
                          <p className="text-base font-semibold text-slate-900">{fmt(r.lineTotal)}</p>
                          {r.price < r.list && r.valid && <p className="text-xs text-emerald-700">Discount {fmt(r.lineList - r.lineTotal)}</p>}
                        </div>
                      </div>
                      {r.p.units.length > 1 && r.p.units.some((u) => !cart.some((x) => x.productId === r.l.productId && x.unitId === u.id)) && (
                        <button type="button" className="mt-2 text-xs font-medium text-navy-700 hover:underline" onClick={() => addOtherUnit(i)}>
                          + Add {r.p.name.length > 24 ? "this product" : "it"} in another unit
                        </button>
                      )}
                      {err && <p className="field-error">{err}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/* ───────── Right: customer, payment, totals ───────── */}
        <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          <div className="card card-pad">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">Customer</h2>
              {perms.addCustomer && !addOpen && (
                <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-navy-700 hover:underline" onClick={() => setAddOpen(true)}>
                  <UserPlus size={14} /> New customer
                </button>
              )}
            </div>
            {customer ? (
              <div className="flex items-start justify-between gap-2 rounded-lg border border-line bg-slate-50/70 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{customer.name}</p>
                  <p className="text-xs text-slate-500">
                    {customer.phone ?? "No phone"} · {customer.type.charAt(0) + customer.type.slice(1).toLowerCase()}
                    {wholesale && " · wholesale prices"}
                  </p>
                  {customer.creditLimit !== undefined && (
                    <p className="text-xs text-slate-500">
                      Owes {fmt(owes)} · limit {limit > 0 ? fmt(limit) : "none"}
                    </p>
                  )}
                </div>
                <button type="button" className="btn-secondary btn-sm shrink-0" onClick={() => setCustomer(null)} aria-label="Remove customer">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="relative">
                <input className="input" placeholder="Walk-in customer. Search to choose one…" value={custQ} onChange={(e) => setCustQ(e.target.value)} aria-label="Search customers" />
                {matches.length > 0 && (
                  <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-line bg-white py-1 shadow-lg">
                    {matches.map((c) => (
                      <li key={c.id}>
                        <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { setCustomer(c); setCustQ(""); }}>
                          <span className="truncate font-medium">{c.name}</span>
                          <span className="shrink-0 text-xs text-slate-500">{c.phone ?? ""}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {fe.customer && <p className="field-error">{fe.customer}</p>}

            {addOpen && (
              <div className="mt-3 space-y-2.5 rounded-lg border border-line p-3">
                <input className="input" placeholder="Customer / business name" value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} aria-label="New customer name" />
                <div className="grid grid-cols-2 gap-2">
                  <input className="input" placeholder="Phone" inputMode="tel" value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} aria-label="New customer phone" />
                  <select className="input" value={newCust.type} onChange={(e) => setNewCust({ ...newCust, type: e.target.value })} aria-label="Customer type">
                    {TYPE_OPTIONS.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
                {addError && <p className="field-error">{addError}</p>}
                <div className="flex gap-2">
                  <button type="button" className="btn-primary btn-sm" disabled={adding || newCust.name.trim().length < 2} onClick={saveNewCustomer}>
                    {adding ? "Adding…" : "Add customer"}
                  </button>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => setAddOpen(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="card card-pad">
            <h2 className="mb-3 text-base font-semibold text-slate-900">Payment</h2>
            {perms.credit && (
              <div className="mb-3 grid grid-cols-3 gap-1.5 rounded-lg bg-slate-100 p-1 text-sm" role="radiogroup" aria-label="Payment type">
                {([["FULL", "Paid in full"], ["PART", "Part payment"], ["CREDIT", "On credit"]] as const).map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={mode === v} onClick={() => setMode(v)} className={cn("rounded-md px-2 py-1.5 font-medium transition", mode === v ? "bg-white text-navy-800 shadow-sm" : "text-slate-600 hover:text-slate-900")}>
                    {l}
                  </button>
                ))}
              </div>
            )}

            {mode !== "CREDIT" && (
              <>
                <p className="label">Paid by</p>
                <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Payment method">
                  {PAYMENT_METHODS.map((m) => (
                    <button key={m.value} type="button" role="radio" aria-checked={method === m.value} onClick={() => setMethod(m.value)} className={cn("rounded-lg border px-2 py-2 text-sm font-medium transition", method === m.value ? "border-navy-600 bg-navy-50 text-navy-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")}>
                      {m.label}
                    </button>
                  ))}
                </div>
                {method !== "CASH" && <input className="input mt-2.5" placeholder="Transaction reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} aria-label="Payment reference" />}
              </>
            )}
            {mode === "PART" && (
              <div className="mt-3">
                <label className="label" htmlFor="pos-part">
                  Amount paid now
                </label>
                <input id="pos-part" className={cn("input", fe.partAmount && "input-error")} inputMode="decimal" value={partAmount} onChange={(e) => setPartAmount(e.target.value)} placeholder="0" />
                {fe.partAmount && <p className="field-error">{fe.partAmount}</p>}
              </div>
            )}
            {(fe.method || fe.payment) && <p className="field-error">{fe.method ?? fe.payment}</p>}

            {overLimit && (
              <div className="mt-3 rounded-lg border border-yellow-300 bg-oil-soft px-3 py-2 text-sm text-yellow-900">
                <p className="font-medium">Over the credit limit</p>
                <p className="text-xs">
                  Owes {fmt(owes)} + this sale {fmt(onCredit)} = {fmt(owes + onCredit)}. Limit {limit > 0 ? fmt(limit) : "not set"}.
                </p>
                {perms.creditException ? (
                  <label className="mt-2 block text-xs">
                    <span className="flex items-center gap-2 font-medium">
                      <input type="checkbox" checked={exception} onChange={(e) => setException(e.target.checked)} className="h-4 w-4 rounded border-slate-400" /> Approve an exception
                    </span>
                    {exception && <input className="input mt-1.5" placeholder="Reason (kept in the audit log)" value={exceptionReason} onChange={(e) => setExceptionReason(e.target.value)} aria-label="Exception reason" />}
                  </label>
                ) : (
                  <p className="mt-1 text-xs">A manager must approve this sale.</p>
                )}
              </div>
            )}
            <input className="input mt-3" placeholder="Note (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Sale note" />
          </div>

          <div className="card card-pad">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between text-slate-600">
                <dt>Subtotal</dt>
                <dd>{fmt(subtotal)}</dd>
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <dt>Discount</dt>
                  <dd>−{fmt(discount)}</dd>
                </div>
              )}
              <div className="flex items-baseline justify-between border-t border-line pt-2 text-lg font-semibold text-slate-900">
                <dt>Total</dt>
                <dd>{fmt(total)}</dd>
              </div>
              {mode !== "FULL" && (
                <>
                  <div className="flex justify-between text-slate-600">
                    <dt>Paid now</dt>
                    <dd>{fmt(paidNow)}</dd>
                  </div>
                  <div className="flex justify-between font-medium text-brand-red-dark">
                    <dt>On credit</dt>
                    <dd>{fmt(onCredit)}</dd>
                  </div>
                </>
              )}
            </dl>
            <div className="mt-4 hidden xl:block">
              <SubmitButton pendingLabel="Completing…" className="btn-primary w-full min-h-11 text-base" >
                Complete sale
              </SubmitButton>
              {!canSubmit && <p className="hint text-center">{problems[0]}</p>}
            </div>
          </div>
        </aside>
      </div>

      {/* Mobile / tablet: the total and the button are always in reach */}
      <div className="fixed inset-x-0 bottom-0 z-30 lg:left-64 border-t border-line bg-white/95 px-4 py-3 shadow-[0_-4px_12px_rgba(15,27,45,0.08)] backdrop-blur xl:hidden">
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-500">{rows.length} item{rows.length === 1 ? "" : "s"}{!canSubmit ? ` · ${problems[0]}` : ""}</p>
            <p className="truncate text-lg font-semibold text-slate-900">{fmt(total)}</p>
          </div>
          <SubmitButton pendingLabel="Completing…" className="btn-primary min-h-11 px-6 text-base">
            Complete sale
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}
