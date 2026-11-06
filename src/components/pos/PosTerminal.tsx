"use client";

import { useActionState, useCallback, useMemo, useRef, useState, useTransition } from "react";
import { ImageOff, Minus, Plus, ScanBarcode, Search, Trash2, UserPlus, X } from "lucide-react";
import { posScan } from "@/app/(app)/scan/actions";
import CodeScanner from "@/components/scan/CodeScanner";
import { parseItemCode } from "@/lib/item-code";
import { Alert } from "@/components/ui";
import { SubmitButton } from "@/components/FormBits";
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
const imgSrc = (p: PosProduct, size: "thumb" | "full" = "thumb") => (p.imageV ? `/api/product-image/${p.id}?size=${size}&v=${p.imageV}` : null);

function Thumb({ p, className }: { p: PosProduct; className?: string }) {
  const src = imgSrc(p);
  return (
    <div className={cn("flex items-center justify-center overflow-hidden bg-gradient-to-b from-white to-slate-100", className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={p.name} loading="lazy" className="h-full w-full object-contain" />
      ) : (
        <ImageOff size={20} className="text-slate-300" aria-label="No picture" />
      )}
    </div>
  );
}

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
  const [discountReason, setDiscountReason] = useState("");
  const [exception, setException] = useState(false);
  const [exceptionReason, setExceptionReason] = useState("");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  // scanning: the camera panel and the last result ("Added ..." or why a piece cannot be sold)
  const [scanOpen, setScanOpen] = useState(false);
  const [scanMsg, setScanMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const cartRef = useRef<CartLine[]>([]);
  const locationIdRef = useRef("");
  const baseUsedRef = useRef<Map<string, number>>(new Map());

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const categories = useMemo(() => [...new Map(products.map((p) => [p.categoryId, p.categoryName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [products]);
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
    const tooHigh = price > list;
    const valid = Number.isFinite(qty) && qty > 0 && Number.isFinite(price) && price >= 0 && list > 0 && !tooHigh;
    return { l, p, unit, list, price, qty, valid, tooHigh, lineList: valid ? round(qty * list) : 0, lineTotal: valid ? round(qty * price) : 0, baseQty: valid ? qty * Number(unit.factor) : 0 };
  });
  const subtotal = rows.reduce((s, r) => s + r.lineList, 0);
  const total = rows.reduce((s, r) => s + r.lineTotal, 0);
  const discount = subtotal - total;

  const baseUsed = new Map<string, number>();
  for (const r of rows) baseUsed.set(r.p.id, (baseUsed.get(r.p.id) ?? 0) + r.baseQty);
  const inStock = (productId: string) => Number(stockByLocation[locationId]?.[productId] ?? 0);
  cartRef.current = cart;
  locationIdRef.current = locationId;
  baseUsedRef.current = baseUsed;

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
  if (discount > 0 && discountReason.trim().length < 3) problems.push("Say why the discount was given");
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
    discountReason: discount > 0 ? discountReason.trim() : null,
    lines: cart.map((l) => ({ productId: l.productId, unitId: l.unitId, quantity: l.quantity, unitPrice: l.price, ...(l.scanned?.length ? { itemCodes: l.scanned.map((x) => x.token) } : {}) })),
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
  // a line can never hold more scanned pieces than its quantity: lowering the quantity drops the last scanned ones
  const fit = (l: CartLine): CartLine => (l.scanned && l.scanned.length > Math.max(Math.floor(Number(l.quantity || 0)), 0) ? { ...l, scanned: l.scanned.slice(0, Math.max(Math.floor(Number(l.quantity || 0)), 0)) } : l);
  const patch = (i: number, p: Partial<CartLine>) => setCart((c) => c.map((l, idx) => (idx === i ? fit({ ...l, ...p }) : l)));
  const step = (i: number, delta: number) => setCart((c) => c.map((l, idx) => (idx === i ? fit({ ...l, quantity: String(Math.max(Number(l.quantity || 0) + delta, 0)) }) : l)));
  const dropScanned = (i: number, token: string) => setCart((c) => c.map((l, idx) => (idx === i ? { ...l, scanned: (l.scanned ?? []).filter((x) => x.token !== token), quantity: String(Math.max(Number(l.quantity || 0) - 1, 0)) } : l)));
  const addOtherUnit = (i: number) =>
    setCart((c) => {
      const l = c[i]!;
      const p = byId.get(l.productId)!;
      const free = p.units.find((u) => !c.some((x) => x.productId === l.productId && x.unitId === u.id));
      return free ? [...c, { productId: l.productId, unitId: free.id, quantity: "1", price: "" }] : c;
    });

  // ── product grid ──
  const term = q.trim().toLowerCase();
  const visible = products.filter(
    (p) =>
      (!category || p.categoryId === category) &&
      (!term || p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term) || (p.barcode ?? "").toLowerCase().includes(term) || (p.brand ?? "").toLowerCase().includes(term)),
  );
  const unitPrice = (p: PosProduct) => Number(wholesale ? p.units[0]!.wholesale : p.units[0]!.retail);
  function cardState(p: PosProduct) {
    const left = inStock(p.id) - (baseUsed.get(p.id) ?? 0);
    const hasPrice = unitPrice(p) > 0;
    return { left, hasPrice, sellable: hasPrice && left > 0 };
  }
  // One scan, from the camera or a scanner. A piece's own QR adds that exact piece; a product barcode adds one by quantity.
  const onCode = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (parseItemCode(code)) {
        const key = code.toUpperCase().replace(/^SDOI:/, "");
        if (cartRef.current.some((l) => l.scanned?.some((x) => x.token === key || x.itemNo === key))) return setScanMsg({ ok: false, text: "This item is already in the cart." });
        const r = await posScan(code, locationIdRef.current);
        if (!r.ok) return setScanMsg({ ok: false, text: r.message });
        const base = byId.get(r.productId)?.baseUnitId;
        if (!base) return setScanMsg({ ok: false, text: `${r.productName} is not in the POS list.` });
        setCart((c) => {
          const i = c.findIndex((l) => l.productId === r.productId && l.unitId === base);
          const item = { token: r.token, itemNo: r.itemNo };
          if (i >= 0) return c.map((l, idx) => (idx === i ? { ...l, quantity: String(Number(l.quantity || 0) + 1), scanned: [...(l.scanned ?? []), item] } : l));
          return [...c, { productId: r.productId, unitId: base, quantity: "1", price: "", scanned: [item] }];
        });
        return setScanMsg({ ok: true, text: `Added ${r.productName} (${r.itemNo})` });
      }
      const key = code.replace(/^SDOP:/i, "").toLowerCase();
      const p = products.find((x) => x.sku.toLowerCase() === key || (x.barcode && x.barcode.toLowerCase() === key));
      if (!p) return setScanMsg({ ok: false, text: "Nothing matches this code." });
      const left = Number(stockByLocation[locationIdRef.current]?.[p.id] ?? 0) - (baseUsedRef.current.get(p.id) ?? 0);
      if (left <= 0) return setScanMsg({ ok: false, text: `${p.name} is out of stock here.` });
      addProduct(p);
      setScanMsg({ ok: true, text: `Added ${p.name}` });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [byId, products, stockByLocation],
  );
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (parseItemCode(q)) {
      // a barcode scanner typed an item's QR text into the search box
      void onCode(q);
      setQ("");
      return;
    }
    const exact = products.find((p) => p.sku.toLowerCase() === term || (p.barcode && p.barcode.toLowerCase() === term)); // a barcode scanner types the code then presses Enter
    const pick = exact ?? (visible.length === 1 ? visible[0] : undefined);
    if (pick && cardState(pick).sellable) {
      addProduct(pick);
      setQ("");
    }
  };

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

  const cartCount = rows.length;

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

      <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
        {/* ───────── Left: product cards ───────── */}
        <section className="min-w-0">
          <div className="card card-pad mb-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
              <div className="relative">
                <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input className="input h-11 pl-10 text-base" placeholder="Search products or scan a barcode…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchKey} aria-label="Search products" autoFocus />
              </div>
              {locations.length > 1 && (
                <select className="input h-11" value={locationId} onChange={(e) => setLocationId(e.target.value)} aria-label="Sell from">
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" className={cn("inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition", scanOpen ? "border-navy-700 bg-navy-700 text-white" : "border-navy-200 bg-navy-50 text-navy-800 hover:bg-navy-100")} onClick={() => setScanOpen((o) => !o)} aria-pressed={scanOpen}>
                <ScanBarcode size={18} /> {scanOpen ? "Close scanner" : "Scan to sell"}
              </button>
              {scanMsg && (
                <p role="status" aria-live="polite" className={cn("min-w-0 flex-1 rounded-lg px-3 py-2 text-sm font-medium", scanMsg.ok ? "bg-emerald-50 text-emerald-800" : "bg-brand-red-soft text-brand-red-dark")}>
                  {scanMsg.text}
                </p>
              )}
            </div>
            {scanOpen && (
              <div className="mt-3">
                <CodeScanner onScan={(c) => void onCode(c)} autoStart compact />
              </div>
            )}
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Categories">
              {[["", "All"], ...categories].map(([id, name]) => (
                <button key={id} type="button" role="tab" aria-selected={category === id} onClick={() => setCategory(id!)} className={cn("shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition", category === id ? "border-navy-700 bg-navy-700 text-white" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50")}>
                  {name}
                </button>
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="card px-6 py-14 text-center text-sm text-slate-500">No product matches “{q}”.</div>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 2xl:grid-cols-4">
              {visible.map((p) => {
                const { left, hasPrice, sellable } = cardState(p);
                const inCart = rows.filter((r) => r.p.id === p.id).reduce((s, r) => s + r.qty, 0);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => addProduct(p)}
                      disabled={!sellable}
                      className={cn(
                        "group relative flex h-full w-full flex-col rounded-2xl border bg-white p-2.5 text-left shadow-[0_1px_2px_rgba(15,27,45,0.05)] transition",
                        sellable ? "border-line hover:-translate-y-0.5 hover:border-navy-300 hover:shadow-md active:translate-y-0" : "cursor-not-allowed border-line opacity-60",
                        inCart > 0 && "border-navy-600 ring-2 ring-navy-200",
                      )}
                    >
                      <div className="relative">
                        <Thumb p={p} className="aspect-square w-full rounded-xl [&_img]:p-1.5 [&_img]:transition [&_img]:duration-200 group-hover:[&_img]:scale-105" />
                        {inCart > 0 && <span className="absolute right-2 top-2 flex h-7 min-w-7 items-center justify-center rounded-full bg-navy-700 px-1.5 text-xs font-semibold text-white shadow">{trim(inCart)}</span>}
                        <span className={cn("absolute bottom-2 left-2 rounded-full px-2 py-0.5 text-[11px] font-semibold backdrop-blur", left <= 0 ? "bg-brand-red text-white" : left <= 5 ? "bg-oil-400 text-navy-950" : "bg-white/90 text-slate-700 ring-1 ring-slate-200")}>
                          {left <= 0 ? "Out of stock" : `${trim(left)} left`}
                        </span>
                      </div>
                      <p className="mt-2.5 line-clamp-2 min-h-10 text-sm font-semibold leading-5 text-slate-900">{p.name}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">{[p.brand, p.packaging].filter(Boolean).join(" · ") || p.categoryName}</p>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        {hasPrice ? <span className="text-base font-bold text-navy-800">{fmt(unitPrice(p))}</span> : <span className="text-xs font-medium text-brand-red-dark">No price set</span>}
                        {sellable && (
                          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-700 text-white transition group-hover:bg-navy-800" aria-hidden>
                            <Plus size={16} />
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ───────── Right: cart, customer, payment ───────── */}
        <aside id="pos-cart" className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="text-base font-semibold text-slate-900">
                Current sale {cartCount > 0 && <span className="text-sm font-normal text-slate-500">({cartCount})</span>}
              </h2>
              {cartCount > 0 && (
                <button type="button" className="text-sm font-medium text-brand-red-dark hover:underline" onClick={() => setCart([])}>
                  Clear cart
                </button>
              )}
            </div>
            {rows.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-slate-500">Tap a product to add it.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {rows.map((r, i) => {
                  const err = fe[`line.${i}`];
                  const free = inStock(r.p.id);
                  const over = (baseUsed.get(r.p.id) ?? 0) > free;
                  const takenUnits = new Set(cart.filter((x, idx) => x.productId === r.l.productId && idx !== i).map((x) => x.unitId));
                  return (
                    <li key={`${r.l.productId}:${r.l.unitId}`} className={cn("px-4 py-3", (err || over) && "bg-brand-red-soft/40")}>
                      <div className="flex gap-3">
                        <Thumb p={r.p} className="h-14 w-14 shrink-0 rounded-lg border border-line [&_img]:p-0.5" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="line-clamp-2 text-sm font-semibold leading-5 text-slate-900">{r.p.name}</p>
                            <button type="button" className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-brand-red-dark" onClick={() => setCart((c) => c.filter((_, idx) => idx !== i))} aria-label={`Remove ${r.p.name}`}>
                              <Trash2 size={16} />
                            </button>
                          </div>
                          <p className={cn("text-xs", over ? "font-medium text-brand-red-dark" : "text-slate-500")}>
                            {over ? `Only ${trim(free)} in stock here` : `${fmt(r.list)} each`}
                            {!over && r.unit.id !== r.p.baseUnitId && r.baseQty > 0 && ` · uses ${trim(r.baseQty)} ${r.p.units[0]!.symbol}`}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <div className="flex items-center gap-1">
                              <button type="button" className="btn-secondary btn-sm px-2" onClick={() => step(i, -1)} aria-label="Decrease quantity">
                                <Minus size={14} />
                              </button>
                              <input className="input h-8 w-14 min-w-0 px-1 text-center" inputMode="decimal" value={r.l.quantity} onChange={(e) => patch(i, { quantity: e.target.value })} aria-label={`Quantity of ${r.p.name}`} />
                              <button type="button" className="btn-secondary btn-sm px-2" onClick={() => step(i, 1)} aria-label="Increase quantity">
                                <Plus size={14} />
                              </button>
                            </div>
                            <select className="input h-8 w-auto py-0 pr-8 text-sm" value={r.l.unitId} onChange={(e) => patch(i, { unitId: e.target.value, price: "" })} disabled={r.p.units.length === 1 || Boolean(r.l.scanned?.length)} aria-label="Unit">
                              {r.p.units.filter((u) => u.id === r.l.unitId || !takenUnits.has(u.id)).map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.name}
                                </option>
                              ))}
                            </select>
                            <span className="ml-auto text-right">
                              <span className="block text-sm font-bold text-slate-900">{fmt(r.lineTotal)}</span>
                              {r.price < r.list && r.valid && <span className="block text-[11px] text-emerald-700">−{fmt(r.lineList - r.lineTotal)}</span>}
                            </span>
                          </div>
                          {r.l.scanned && r.l.scanned.length > 0 && (
                            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Scanned items">
                              {r.l.scanned.map((x) => (
                                <li key={x.token} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-800">
                                  {x.itemNo}
                                  <button type="button" className="rounded-full p-0.5 hover:bg-emerald-100" onClick={() => dropScanned(i, x.token)} aria-label={`Remove ${x.itemNo}`}>
                                    <X size={11} />
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                          {perms.discount && (
                            <div className="mt-2 flex items-center gap-2">
                              <label className="text-xs text-slate-500" htmlFor={`pos-price-${i}`}>
                                Price each
                              </label>
                              <input id={`pos-price-${i}`} className="input h-8 w-28 px-2 text-sm" inputMode="decimal" value={r.l.price} placeholder={nf.format(r.list)} onChange={(e) => patch(i, { price: e.target.value })} />
                            </div>
                          )}
                          {r.p.units.length > 1 && r.p.units.some((u) => !cart.some((x) => x.productId === r.l.productId && x.unitId === u.id)) && (
                            <button type="button" className="mt-1.5 text-xs font-medium text-navy-700 hover:underline" onClick={() => addOtherUnit(i)}>
                              + Add in another unit
                            </button>
                          )}
                        </div>
                      </div>
                      {(err || r.tooHigh) && <p className="field-error">{err ?? "The price cannot be higher than the list price."}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
            {discount > 0 && (
              <div className="border-t border-line bg-emerald-50/60 px-4 py-3">
                <label className="label" htmlFor="pos-discount-reason">
                  Why is a discount given? <span className="text-brand-red">*</span>
                </label>
                <input id="pos-discount-reason" className={cn("input", fe.discountReason && "input-error")} value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} placeholder="e.g. regular customer, damaged box" />
                {fe.discountReason && <p className="field-error">{fe.discountReason}</p>}
                <p className="hint">Saved on the sale together with your name.</p>
              </div>
            )}
          </div>

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
                <input className="input" placeholder="Walk-in customer (search to choose one)" value={custQ} onChange={(e) => setCustQ(e.target.value)} aria-label="Search customers" />
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
              <div className="flex items-baseline justify-between border-t border-line pt-2 text-xl font-bold text-slate-900">
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
              <SubmitButton pendingLabel="Completing…" className="btn-primary min-h-12 w-full text-base">
                Complete sale
              </SubmitButton>
              {!canSubmit && <p className="hint text-center">{problems[0]}</p>}
            </div>
          </div>
        </aside>
      </div>

      {/* Mobile / tablet: the total and the button are always in reach */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 px-4 py-3 shadow-[0_-4px_12px_rgba(15,27,45,0.08)] backdrop-blur lg:left-64 xl:hidden">
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => document.getElementById("pos-cart")?.scrollIntoView({ behavior: "smooth" })}>
            <p className="text-xs text-slate-500">
              {cartCount} item{cartCount === 1 ? "" : "s"}
              {!canSubmit ? ` · ${problems[0]}` : " · tap to review"}
            </p>
            <p className="truncate text-lg font-bold text-slate-900">{fmt(total)}</p>
          </button>
          <SubmitButton pendingLabel="Completing…" className="btn-primary min-h-12 px-6 text-base">
            Complete sale
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}
