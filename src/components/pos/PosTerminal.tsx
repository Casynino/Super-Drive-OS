"use client";

import Link from "next/link";
import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, ImageOff, Minus, Plus, ScanBarcode, Search, Trash2, UserPlus, X } from "lucide-react";
import { posScan } from "@/app/(app)/scan/actions";
import CodeScanner from "@/components/scan/CodeScanner";
import { LABELS_ENABLED } from "@/lib/features";
import { parseItemCode } from "@/lib/item-code";
import { SubmitButton } from "@/components/FormBits";
import type { ActionState } from "@/lib/action";
import { defaultUnitId, type LocationOption } from "@/lib/inventory/types";
import { largestPack, qtyText, type UnitMode } from "@/lib/qty";
import AccountButtons from "@/components/cash/AccountButtons";
import RegisterModal, { type RegisterForm } from "@/components/pos/RegisterModal";
import SaleDoneModal from "@/components/pos/SaleDoneModal";
import { useRouter } from "next/navigation";
import WingaActions from "@/components/pos/WingaActions";
import type { TillSummary } from "@/app/(app)/till/actions";
import { PAYMENT_METHODS, type CartLine, type PayAccount, type PosCustomer, type PosProduct } from "@/lib/sales/types";
import { cn } from "@/lib/utils";

type Props = {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  quickAddCustomer: (input: { name: string; phone: string; type: string; idNumber?: string; place?: string; forCredit?: boolean }) => Promise<{ ok: true; customer: { id: string; name: string; phone: string | null; type: string } } | { ok: false; error: string }>;
  /** registers a Winga (account + stock location) without leaving the till */
  quickAddWinga?: (input: { name: string; phone: string; idInfo: string; businessName?: string; place?: string }) => Promise<{ ok: true; customer: { id: string; name: string; phone: string | null; type: string } } | { ok: false; error: string }>;
  /** a Winga to start the sale for (customer id) */
  initialWingaId?: string;
  products: PosProduct[];
  locations: LocationOption[];
  stockByLocation: Record<string, Record<string, string>>;
  customers: PosCustomer[];
  /** every open cash / mobile-money / bank account: the cashier says which one the money went into */
  accounts: PayAccount[];
  submissionKey: string;
  currency: { code: string; symbol: string; decimals: number };
  perms: { credit: boolean; discount: boolean; addCustomer: boolean; addWinga?: boolean; collect?: boolean; returns?: boolean; viewWinga?: boolean; viewCustomer?: boolean; creditException: boolean };
  /** the CTN | PCS switch: cartons are the default, PCS makes new lines start in pieces */
  unitMode: UnitMode;
};

const initial: ActionState = {};
const WHOLESALE = ["WHOLESALE", "DISTRIBUTOR"];
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

export default function PosTerminal({ action, quickAddCustomer, quickAddWinga, initialWingaId, products, locations, stockByLocation, customers: initialCustomers, accounts, submissionKey: key, currency, perms, unitMode }: Props) {
  const [state, formAction] = useActionState(action, initial);
  // A refusal from the server is shown small, next to the Complete sale button (not as a banner at the top of the page),
  // and goes away as soon as the person changes the sale.
  const [seenState, setSeenState] = useState(state);
  const fe = state.fieldErrors ?? {};
  const [submissionKey, setSubmissionKey] = useState(key); // one key per sale: a double click cannot create two sales
  const router = useRouter();
  // after Complete sale the till stays here and shows the "Sale complete" pop-up (state.message = the new sale's id)
  const [doneId, setDoneId] = useState<string | null>(null);
  const lastDone = useRef<string | null>(null);
  useEffect(() => {
    if (state.ok && state.message && state.message !== lastDone.current) {
      lastDone.current = state.message;
      setDoneId(state.message);
    }
  }, [state]);

  const [locationId, setLocationId] = useState(locations.find((l) => l.isDefault)?.id ?? locations[0]!.id);
  const [customers, setCustomers] = useState(initialCustomers);
  // opened from the Winga page ("Sell"): that Winga is already chosen and the sale is on credit
  const seedWinga = initialWingaId ? initialCustomers.find((c) => c.id === initialWingaId && c.winga) ?? null : null;
  const [customer, setCustomer] = useState<PosCustomer | null>(seedWinga);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [mode, setMode] = useState<"FULL" | "CREDIT" | "PART">(seedWinga && perms.credit ? "CREDIT" : "FULL");
  const [who, setWho] = useState<"walkin" | "credit" | "winga">(seedWinga ? "winga" : "walkin"); // a walk-in needs nothing written down
  const [accountPick, setAccountPick] = useState("");
  const [methodPick, setMethodPick] = useState<PayAccount["method"]>("CASH"); // only used when no accounts are set up yet
  const locAccounts = accounts.filter((a) => a.locationId === locationId);
  // the account chosen at this location; until one is pressed, the till
  const account = locAccounts.find((a) => a.id === accountPick) ?? locAccounts.find((a) => a.method === "CASH") ?? locAccounts[0] ?? null;
  const method = account?.method ?? methodPick;
  const [partAmount, setPartAmount] = useState("");
  const [reference, setReference] = useState("");
  const notes = ""; // no note box at the till (Nino 2026-11-08)
  const [discountReason, setDiscountReason] = useState("");
  const [exception, setException] = useState(false);
  const [dueDate, setDueDate] = useState(""); // the day a normal customer says they will pay what is left on credit
  const [exceptionReason, setExceptionReason] = useState("");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  // scanning: the camera panel and the last result ("Added ..." or why a piece cannot be sold)
  const [scanOpen, setScanOpen] = useState(false);
  const [scanMsg, setScanMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const cartRef = useRef<CartLine[]>([]);
  const listRef = useRef<HTMLUListElement>(null);
  const locationIdRef = useRef("");
  const baseUsedRef = useRef<Map<string, number>>(new Map());

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const categories = useMemo(() => [...new Map(products.map((p) => [p.categoryId, p.categoryName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [products]);
  const nf = useMemo(() => new Intl.NumberFormat("en-US", { minimumFractionDigits: currency.decimals, maximumFractionDigits: currency.decimals }), [currency.decimals]);
  const fmt = (n: number) => `${currency.symbol} ${nf.format(n)}`;
  const round = (n: number) => Number(n.toFixed(currency.decimals));
  const orderWord = (n: number) => (n === 0 ? "no open orders" : n === 1 ? "1 open order" : `${n} open orders`);
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
  // a Winga with no limit set has no cap; a limit above 0 still caps them
  const noCap = customer?.winga === true && limit <= 0;
  const overLimit = onCredit > 0 && !noCap && customer?.creditLimit !== undefined && owes + onCredit > limit;

  const problems: string[] = [];
  if (cart.length === 0) problems.push("Add a product");
  else if (rows.some((r) => !r.valid)) problems.push("Fix the quantities or prices");
  if (mode !== "FULL" && !customer) problems.push(who === "winga" ? "Choose the Winga" : "Choose a registered customer");
  if (mode !== "FULL" && customer && !customer.winga && customer.complete === false) problems.push("Complete the customer's details first");
  if (mode !== "FULL" && customer?.winga && customer.late) problems.push("The Winga must pay what is overdue first");
  if (mode === "PART" && !(partNum > 0 && partNum < total)) problems.push("Enter a part payment below the total");
  if (mode !== "FULL" && customer && !customer.winga && !dueDate) problems.push("Choose the day the customer will pay");
  if (discount > 0 && discountReason.trim().length < 3) problems.push("Say why the discount was given");
  if (overLimit && perms.creditException && exception && exceptionReason.trim().length < 5) problems.push("Give a reason for the exception");
  const canSubmit = problems.length === 0;

  const payload = JSON.stringify({
    customerId: customer?.id ?? null,
    locationId,
    mode,
    method: mode === "CREDIT" ? null : method,
    accountId: mode === "CREDIT" ? null : (account?.id ?? null),
    partAmount: mode === "PART" ? partAmount : null,
    reference: reference.trim() || null,
    notes: notes.trim() || null,
    discountReason: discount > 0 ? discountReason.trim() : null,
    lines: cart.map((l) => ({ productId: l.productId, unitId: l.unitId, quantity: l.quantity, unitPrice: l.price, ...(l.scanned?.length ? { itemCodes: l.scanned.map((x) => x.token) } : {}) })),
    creditException: overLimit && perms.creditException && exception ? { reason: exceptionReason.trim() } : null,
    dueDate: mode !== "FULL" && customer && !customer.winga ? dueDate || null : null,
    submissionKey,
  });

  // ── cart actions ──
  const addProduct = (p: PosProduct) =>
    setCart((c) => {
      // cartons first: a product starts in its default selling unit (the carton when it has one)
      const unitId = unitMode === "pcs" && p.allowPieceSales !== false ? p.baseUnitId : defaultUnitId(p, "sales");
      const i = c.findIndex((l) => l.productId === p.id && l.unitId === unitId);
      if (i >= 0) return c.map((l, idx) => (idx === i ? { ...l, quantity: String(Number(l.quantity || 0) + 1) } : l));
      return [...c, { productId: p.id, unitId, quantity: "1", price: "" }];
    });
  // a line can never hold more scanned pieces than its quantity: lowering the quantity drops the last scanned ones
  const fit = (l: CartLine): CartLine => (l.scanned && l.scanned.length > Math.max(Math.floor(Number(l.quantity || 0)), 0) ? { ...l, scanned: l.scanned.slice(0, Math.max(Math.floor(Number(l.quantity || 0)), 0)) } : l);
  // Changing CTN to PCS (or back) keeps the same real amount when it comes out whole: 1 CTN of 12 becomes 12 PCS, and 12 PCS becomes 1 CTN.
  const switchUnit = (i: number, unitId: string) =>
    setCart((c) =>
      c.map((l, idx) => {
        if (idx !== i) return l;
        const p = products.find((x) => x.id === l.productId);
        const from = Number(p?.units.find((u) => u.id === l.unitId)?.factor ?? 1);
        const to = Number(p?.units.find((u) => u.id === unitId)?.factor ?? 1);
        const q = Number(l.quantity);
        const next = q > 0 && to > 0 ? (q * from) / to : q;
        const whole = Number.isFinite(next) && Math.abs(next - Math.round(next)) < 1e-9;
        return fit({ ...l, unitId, price: "", quantity: whole ? String(Math.round(next)) : l.quantity });
      }),
    );
  const patch = (i: number, p: Partial<CartLine>) => setCart((c) => c.map((l, idx) => (idx === i ? fit({ ...l, ...p }) : l)));
  const step = (i: number, delta: number) => setCart((c) => c.map((l, idx) => (idx === i ? fit({ ...l, quantity: String(Math.max(Number(l.quantity || 0) + delta, 0)) }) : l)));
  // Pieces that make whole cartons count as cartons (12 PCS of a 12-piece carton become 1 CTN, at the carton price).
  // Done when the person finishes typing or presses + / -, never while typing, so "120" is never turned into "1 CTN" half way.
  const normalize = (i: number) =>
    setCart((c) => {
      const l = c[i];
      const p = l ? products.find((x) => x.id === l.productId) : undefined;
      if (!l || !p || l.unitId !== p.baseUnitId || l.scanned?.length) return c;
      const pack = [...p.units].filter((u) => Number(u.factor) > 1).sort((a, b) => Number(b.factor) - Number(a.factor))[0];
      const q = Number(l.quantity);
      if (!pack || !(q > 0) || !Number.isInteger(q / Number(pack.factor))) return c;
      const cartons = q / Number(pack.factor);
      const other = c.findIndex((x, idx) => idx !== i && x.productId === l.productId && x.unitId === pack.id);
      if (other >= 0) return c.map((x, idx) => (idx === other ? { ...x, quantity: String(Number(x.quantity || 0) + cartons) } : x)).filter((_, idx) => idx !== i);
      return c.map((x, idx) => (idx === i ? { ...x, unitId: pack.id, quantity: String(cartons), price: "" } : x));
    });
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
  const saleError = state.error && seenState !== state ? state.error : null;
  useEffect(() => setSeenState(state), [cart, customer, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  // a newly added product shows at the bottom of the cart list: keep it in view
  const lineCount = cart.length;
  const prevLines = useRef(0);
  useEffect(() => {
    if (lineCount > prevLines.current) listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    prevLines.current = lineCount;
  }, [lineCount]);

  // the unit one tap adds (same rule as addProduct): the carton by default
  const cardUnit = (p: PosProduct) => {
    const id = unitMode === "pcs" && p.allowPieceSales !== false ? p.baseUnitId : defaultUnitId(p, "sales");
    return p.units.find((u) => u.id === id) ?? p.units[0]!;
  };
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
  // Who is buying: a walk-in (nothing written down, pays in full), a registered credit customer, or a Winga.
  const chooseWho = (w: "walkin" | "credit" | "winga") => {
    setWho(w);
    setCustomer(null);
    setCustQ("");
    setAddOpen(false);
    setPartAmount("");
    setMode(w !== "walkin" && perms.credit ? "CREDIT" : "FULL");
  };
  // New sale: everything is cleared, the next customer starts from Walk-in, stock and balances are re-read
  const newSale = () => {
    setDoneId(null);
    setCart([]);
    chooseWho("walkin");
    setDueDate("");
    setException(false);
    setExceptionReason("");
    setDiscountReason("");
    setReference("");
    setScanMsg(null);
    setScanOpen(false);
    setSubmissionKey(crypto.randomUUID());
    router.refresh();
  };
  const creditList = customers.filter((c) => !c.winga && (!custQ.trim() || c.name.toLowerCase().includes(custQ.trim().toLowerCase()) || (c.phone ?? "").includes(custQ.trim()))).slice(0, 60);
  const matches = custQ.trim() ? customers.filter((c) => !c.winga && (c.name.toLowerCase().includes(custQ.trim().toLowerCase()) || (c.phone ?? "").includes(custQ.trim()))).slice(0, 6) : [];
  // Choosing a credit customer or a Winga puts the sale on credit (the person can still change it to paid in full).
  const pickCustomer = (c: PosCustomer) => {
    setCustomer(c);
    setCustQ("");
    if (perms.credit) setMode("CREDIT");
  };
  const wingaList = customers.filter((c) => c.winga && (!custQ.trim() || c.name.toLowerCase().includes(custQ.trim().toLowerCase()) || (c.phone ?? "").includes(custQ.trim())));
  // A new Winga / credit customer is registered in a pop-up; once saved they show on the list, ready to be chosen.
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const registerPerson = async (f: RegisterForm): Promise<string | null> => {
    const isWinga = who === "winga" && Boolean(quickAddWinga);
    const r = isWinga ? await quickAddWinga!({ name: f.name, phone: f.phone, idInfo: f.idNumber, businessName: f.business, place: f.place }) : await quickAddCustomer({ name: f.name, phone: f.phone, type: f.type, idNumber: f.idNumber, place: f.place, forCredit: true });
    if (!r.ok) return r.error;
    const c: PosCustomer = { ...r.customer, complete: true, ...(isWinga ? { winga: true } : {}), ...(perms.credit ? { creditLimit: "0", outstanding: "0", openOrders: 0 } : {}) };
    setCustomers((all) => [c, ...all]);
    setJustAdded(c.id);
    setAddOpen(false);
    return null;
  };
  // after money or goods came in from a pop-up: the balance on the till follows
  const refreshCustomer = (id: string, s: TillSummary) => {
    const apply = (c: PosCustomer): PosCustomer => (c.id === id ? { ...c, outstanding: s.owed, openOrders: s.openOrders, late: s.late } : c);
    setCustomers((all) => all.map(apply));
    setCustomer((c) => (c ? apply(c) : c));
  };

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
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_420px]">
        {/* ───────── Left: product cards ───────── */}
        <section className="min-w-0">
          <div className="card mb-3 p-2.5">
            {/* one slim row: search, shop (when there is more than one) and the categories; wraps on a phone */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[12rem] flex-1 basis-56 sm:max-w-xs">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input className="input h-10 pl-9 text-sm" placeholder="Search products…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchKey} aria-label="Search products" autoFocus />
              </div>
              {locations.length > 1 && (
                <select className="input h-10 w-auto max-w-[11rem] text-sm" value={locationId} onChange={(e) => setLocationId(e.target.value)} aria-label="Sell from">
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              )}
              <div className="flex min-w-0 flex-[2_1_10rem] gap-1.5 overflow-x-auto" role="tablist" aria-label="Categories">
                {[["", "All"], ...categories].map(([id, name]) => (
                  <button key={id} type="button" role="tab" aria-selected={category === id} onClick={() => setCategory(id!)} className={cn("shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition", category === id ? "border-navy-700 bg-navy-700 text-white" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50")}>
                    {name}
                  </button>
                ))}
              </div>
            </div>
            {LABELS_ENABLED && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" className={cn("inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition", scanOpen ? "border-navy-700 bg-navy-700 text-white" : "border-navy-200 bg-navy-50 text-navy-800 hover:bg-navy-100")} onClick={() => setScanOpen((o) => !o)} aria-pressed={scanOpen}>
                  <ScanBarcode size={18} /> {scanOpen ? "Close scanner" : "Scan to sell"}
                </button>
                {scanMsg && (
                  <p role="status" aria-live="polite" className={cn("min-w-0 flex-1 rounded-lg px-3 py-2 text-sm font-medium", scanMsg.ok ? "bg-emerald-50 text-emerald-800" : "bg-brand-red-soft text-brand-red-dark")}>
                    {scanMsg.text}
                  </p>
                )}
              </div>
            )}
            {scanOpen && (
              <div className="mt-2">
                <CodeScanner onScan={(c) => void onCode(c)} autoStart compact />
              </div>
            )}
          </div>

          {visible.length === 0 ? (
            <div className="card px-6 py-14 text-center text-sm text-slate-500">No product matches “{q}”.</div>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 2xl:grid-cols-4">
              {visible.map((p) => {
                const { left, hasPrice, sellable } = cardState(p);
                const inCart = rows.filter((r) => r.p.id === p.id).reduce((s, r) => s + r.qty, 0);
                // the price shown is the price of what one tap adds: a carton for products sold by the carton
                const cu = cardUnit(p);
                const cuPrice = Number(wholesale ? cu.wholesale : cu.retail);
                const perPiece = cu.id !== p.baseUnitId ? unitPrice(p) : 0;
                const stockTone = left <= 0 ? "bg-brand-red" : left <= 5 ? "bg-oil-400" : "bg-emerald-500";
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => addProduct(p)}
                      disabled={!sellable}
                      className={cn(
                        "group relative flex h-full w-full flex-col rounded-2xl border bg-white p-2 text-left shadow-[0_1px_2px_rgba(15,27,45,0.05)] transition duration-150",
                        sellable ? "border-line hover:-translate-y-0.5 hover:border-navy-300 hover:shadow-md active:translate-y-0 active:scale-[0.99]" : "cursor-not-allowed border-line opacity-60",
                        inCart > 0 && "border-navy-600 ring-2 ring-navy-200",
                      )}
                    >
                      <div className="relative">
                        <Thumb p={p} className="aspect-[5/4] w-full rounded-xl [&_img]:p-2 [&_img]:transition [&_img]:duration-200 group-hover:[&_img]:scale-105" />
                        {inCart > 0 && <span className="absolute right-1.5 top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-navy-700 px-1.5 text-xs font-semibold text-white shadow">{trim(inCart)}</span>}
                        <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-2 py-0.5 text-[11px] font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 backdrop-blur">
                          <span className={cn("h-1.5 w-1.5 rounded-full", stockTone)} aria-hidden />
                          {left <= 0 ? "Out of stock" : `${qtyText(left, largestPack(p.units), p.units[0]?.symbol ?? "", unitMode).main} left`}
                        </span>
                      </div>
                      <div className="flex flex-1 flex-col px-1 pb-0.5 pt-2">
                        <p className="line-clamp-2 min-h-[2.5rem] text-[13.5px] font-semibold leading-5 text-slate-900">{p.name}</p>
                        <p className="mt-0.5 truncate text-[11px] text-slate-500">{[p.brand, p.packaging].filter(Boolean).join(" · ") || p.categoryName}</p>
                        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
                          {hasPrice ? (
                            <span className="min-w-0">
                              <span className="block whitespace-nowrap text-[15px] font-bold leading-5 text-navy-800">{fmt(cuPrice)}</span>
                              <span className="block truncate text-[11px] text-slate-500">
                                per {cu.symbol}
                                {perPiece > 0 && ` · ${fmt(perPiece)} each`}
                              </span>
                            </span>
                          ) : (
                            <span className="text-xs font-medium text-brand-red-dark">No price set</span>
                          )}
                          {sellable && (
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-700 text-white transition group-hover:bg-navy-800 group-hover:shadow" aria-hidden>
                              <Plus size={16} />
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ───────── Right: cart, customer, payment ───────── */}
        <aside id="pos-cart" className="space-y-4 xl:sticky xl:top-6 xl:self-start">
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
              <ul ref={listRef} className="divide-y divide-slate-100 md:max-h-[min(24rem,48vh)] md:overflow-y-auto">
                {rows.map((r, i) => {
                  const err = fe[`line.${i}`];
                  const free = inStock(r.p.id);
                  const over = (baseUsed.get(r.p.id) ?? 0) > free;
                  const takenUnits = new Set(cart.filter((x, idx) => x.productId === r.l.productId && idx !== i).map((x) => x.unitId));
                  const stepBtn = "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 transition hover:bg-slate-50";
                  return (
                    <li key={`${r.l.productId}:${r.l.unitId}`} className={cn("px-3 py-2.5", (err || over) && "bg-brand-red-soft/40")}>
                      {/* line 1: picture, name and what it costs; line 2: the controls (quantity, unit, price) */}
                      <div className="flex items-center gap-2.5">
                        <Thumb p={r.p} className="h-10 w-10 shrink-0 rounded-lg border border-line [&_img]:p-0.5" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-semibold leading-5 text-slate-900" title={r.p.name}>
                            {r.p.name}
                          </p>
                          <p className={cn("truncate text-[11px]", over ? "font-medium text-brand-red-dark" : "text-slate-500")}>
                            {over ? `Only ${trim(free)} in stock here` : `${fmt(r.list)} each`}
                            {!over && r.unit.id !== r.p.baseUnitId && r.baseQty > 0 && ` · uses ${trim(r.baseQty)} ${r.p.units[0]!.symbol}`}
                          </p>
                        </div>
                        <span className="shrink-0 text-right">
                          <span className="block text-sm font-bold text-slate-900">{fmt(r.lineTotal)}</span>
                          {r.price < r.list && r.valid && <span className="block text-[11px] text-emerald-700">−{fmt(r.lineList - r.lineTotal)}</span>}
                        </span>
                        <button type="button" className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-brand-red-dark" onClick={() => setCart((c) => c.filter((_, idx) => idx !== i))} aria-label={`Remove ${r.p.name}`}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-[3.125rem]">
                        <div className="flex items-center gap-1">
                          <button type="button" className={stepBtn} onClick={() => { step(i, -1); normalize(i); }} aria-label="Decrease quantity">
                            <Minus size={13} />
                          </button>
                          <input className="input h-7 w-10 min-w-0 px-1 text-center text-sm" inputMode="decimal" value={r.l.quantity} onChange={(e) => patch(i, { quantity: e.target.value })} onBlur={() => normalize(i)} aria-label={`Quantity of ${r.p.name}`} />
                          <button type="button" className={stepBtn} onClick={() => { step(i, 1); normalize(i); }} aria-label="Increase quantity">
                            <Plus size={13} />
                          </button>
                        </div>
                        <select className="input h-7 w-auto py-0 pl-2 pr-6 text-[13px]" value={r.l.unitId} onChange={(e) => switchUnit(i, e.target.value)} disabled={r.p.units.length === 1 || Boolean(r.l.scanned?.length)} aria-label="Unit">
                          {r.p.units.filter((u) => (u.id === r.l.unitId || !takenUnits.has(u.id)) && (u.id !== r.p.baseUnitId || r.p.allowPieceSales !== false || r.p.units.length === 1 || u.id === r.l.unitId)).map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </select>
                        {perms.discount && (
                          <input id={`pos-price-${i}`} className="input h-7 w-[5.25rem] px-2 text-right text-[13px]" inputMode="decimal" value={r.l.price} placeholder={nf.format(r.list)} title="Price each" onChange={(e) => patch(i, { price: e.target.value })} aria-label={`Price each for ${r.p.name}`} />
                        )}
                        {r.p.units.length > 1 && r.p.units.some((u) => !cart.some((x) => x.productId === r.l.productId && x.unitId === u.id)) && (
                          <button type="button" className="text-[11px] font-medium text-navy-700 hover:underline" title="Add in another unit" onClick={() => addOtherUnit(i)}>
                            + unit
                          </button>
                        )}
                      </div>
                      {r.l.scanned && r.l.scanned.length > 0 && (
                        <ul className="mt-1.5 flex flex-wrap gap-1.5 pl-[3.125rem]" aria-label="Scanned items">
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
                      {(err || r.tooHigh) && <p className="field-error pl-[3.125rem]">{err ?? "The price cannot be higher than the list price."}</p>}
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
              <div className="flex items-center gap-3">
                {who === "winga" && perms.viewWinga && (
                  <Link href="/resellers" target={cartCount > 0 ? "_blank" : undefined} rel={cartCount > 0 ? "noopener" : undefined} className="text-xs font-medium text-navy-700 hover:underline" title="See every Winga with what they owe, to collect money or take goods back">
                    All Winga
                  </Link>
                )}
                {who !== "walkin" && perms.addCustomer && !customer && !addOpen && (who === "credit" || (perms.addWinga && quickAddWinga)) && (
                  <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-navy-700 hover:underline" onClick={() => setAddOpen(true)}>
                    <UserPlus size={14} /> {who === "winga" ? "New Winga" : "New credit customer"}
                  </button>
                )}
              </div>
            </div>

            {/* Who is buying: most people are walk-ins and need nothing written down */}
            <div className="mb-3 grid grid-cols-3 gap-1.5 rounded-lg bg-slate-100 p-1 text-sm" role="radiogroup" aria-label="Who is buying">
              {([["walkin", "Walk-in"], ["winga", "Winga"], ["credit", perms.credit ? "Credit" : "Customer"]] as const).map(([v, l]) => (
                <button key={v} type="button" role="radio" aria-checked={who === v} onClick={() => chooseWho(v)} className={cn("rounded-md px-2 py-1.5 font-medium transition", who === v ? "bg-white text-navy-800 shadow-sm" : "text-slate-600 hover:text-slate-900")}>
                  {l}
                </button>
              ))}
            </div>

            {who === "walkin" && <p className="text-sm text-slate-500">No name or details needed. Walk-in customers pay in full.</p>}

            {who !== "walkin" && customer && (
              <div className="rounded-lg border border-line bg-slate-50/70 px-3 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{customer.name}</p>
                    <p className="text-xs text-slate-500">
                      {customer.phone ?? "No phone"} · {customer.winga ? "Winga" : customer.type.charAt(0) + customer.type.slice(1).toLowerCase()}
                      {wholesale && " · wholesale prices"}
                    </p>
                  </div>
                  <button type="button" className="btn-secondary btn-sm shrink-0" onClick={() => setCustomer(null)} aria-label="Remove customer">
                    <X size={14} />
                  </button>
                </div>
                {customer.creditLimit !== undefined && (
                  <div className="mt-2 flex items-baseline justify-between gap-2 border-t border-line pt-2">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Balance</p>
                      <p className={cn("text-base font-bold", owes > 0 ? "text-brand-red-dark" : "text-slate-900")}>{fmt(owes)}</p>
                    </div>
                    <p className="text-right text-xs text-slate-500">
                      <span className="block font-medium text-slate-700">{orderWord(customer.openOrders ?? 0)}</span>
                      {limit > 0 ? `limit ${fmt(limit)}` : customer.winga ? "no limit · pays within 3 days" : "limit none"}
                    </p>
                  </div>
                )}
                {customer.late && <p className="mt-1.5 text-xs font-medium text-brand-red-dark">Overdue {fmt(Number(customer.late.amount))} since {customer.late.since}. {customer.winga ? "He must pay before he can take more goods." : ""}</p>}
                {!customer.winga && customer.complete === false && (
                  <p className="mt-1.5 text-xs font-medium text-brand-red-dark">
                    Not fully registered: phone, ID number and place are needed for credit.{" "}
                    <Link href={`/customers/${customer.id}`} target={cartCount > 0 ? "_blank" : undefined} rel={cartCount > 0 ? "noopener" : undefined} className="underline">
                      Complete the details
                    </Link>
                  </p>
                )}
                <div className="mt-2.5">
                  <WingaActions
                    customerId={customer.id}
                    name={customer.name}
                    canCollect={perms.collect && owes > 0}
                    canReturn={perms.returns && customer.winga === true && owes > 0}
                    accounts={locAccounts}
                    currency={currency}
                    emphasizeCollect={Boolean(customer.late)}
                    onDone={(sum) => refreshCustomer(customer.id, sum)}
                    openHref={customer.winga ? (customer.wingaId && perms.viewWinga ? `/resellers/${customer.wingaId}` : undefined) : perms.viewCustomer ? `/customers/${customer.id}` : undefined}
                    openNewTab={cartCount > 0}
                    short
                  />
                </div>
              </div>
            )}

            {who === "credit" && !customer && (
              <div>
                <input className="input" placeholder="Search a registered customer" value={custQ} onChange={(e) => setCustQ(e.target.value)} aria-label="Search customers" />
                {justAdded && customers.some((c) => c.id === justAdded && !c.winga) && <p className="mt-2 text-xs font-medium text-emerald-700">Saved. Tap the customer below to choose.</p>}
                {creditList.length > 0 ? (
                  <ul className="mt-2 max-h-56 divide-y divide-line overflow-y-auto rounded-lg border border-line md:max-h-64">
                    {creditList.map((c) => (
                      <li key={c.id}>
                        <button type="button" className={cn("flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-slate-50", c.id === justAdded && "bg-emerald-50/60")} onClick={() => pickCustomer(c)}>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-slate-900">{c.name}</span>
                            <span className="block truncate text-xs text-slate-500">
                              {c.phone ?? "No phone"}
                              {c.outstanding !== undefined && Number(c.outstanding) > 0 && <span className="font-medium text-brand-red-dark"> · owes {fmt(Number(c.outstanding))}</span>}
                            </span>
                          </span>
                          <ChevronRight size={16} className="shrink-0 text-slate-400" aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">No registered customer found.{perms.addCustomer ? " Use New credit customer to register one." : ""}</p>
                )}
              </div>
            )}

            {who === "winga" && !customer && (
              <div>
                {justAdded && customers.some((c) => c.id === justAdded && c.winga) && <p className="mb-2 text-xs font-medium text-emerald-700">Saved. Tap the Winga below to choose.</p>}
                {wingaList.length > 0 ? (
                  <ul className="max-h-52 divide-y divide-line overflow-y-auto rounded-lg border border-line md:max-h-64">
                    {wingaList.map((w) => {
                      const o = Number(w.outstanding ?? 0);
                      const lateAmt = w.late ? Number(w.late.amount) : 0;
                      return (
                        <li key={w.id}>
                          {/* one tap picks the Winga; what to do next (sell, return goods, collect money) comes after */}
                          <button type="button" className={cn("flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-slate-50", w.id === justAdded && "bg-emerald-50/60")} onClick={() => pickCustomer(w)}>
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-slate-900">{w.name}</span>
                              <span className={cn("block text-xs", o > 0 ? "font-medium text-brand-red-dark" : "text-slate-500")}>
                                {w.outstanding === undefined ? (w.phone ?? "") : lateAmt > 0 ? `Overdue ${fmt(lateAmt)} · ${orderWord(w.openOrders ?? 0)}` : o > 0 ? `Owes ${fmt(o)} · ${orderWord(w.openOrders ?? 0)}` : "Owes nothing · no open orders"}
                              </span>
                            </span>
                            <ChevronRight size={16} className="shrink-0 text-slate-400" aria-hidden />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">No Winga registered yet.</p>
                )}
              </div>
            )}
            {fe.customer && <p className="field-error">{fe.customer}</p>}

            <RegisterModal open={addOpen && who !== "walkin"} kind={who === "winga" ? "winga" : "credit"} onClose={() => setAddOpen(false)} onSave={registerPerson} />
          </div>

          <div className="card card-pad">
            <h2 className="mb-3 text-base font-semibold text-slate-900">Payment</h2>
            {/* No "paid in full" choice here: a walk-in always pays in full, and a credit customer or a Winga always takes goods on credit (they may pay some now). */}
            {mode !== "FULL" && customer && !customer.winga && (
              <div className="mb-3">
                <label className="label" htmlFor="pos-due">
                  The customer will pay on <span className="text-brand-red">*</span>
                </label>
                <input id="pos-due" type="date" className={cn("input", fe.dueDate && "input-error")} min={new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Dar_es_Salaam" })} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                {fe.dueDate && <p className="field-error">{fe.dueDate}</p>}
              </div>
            )}
            {mode !== "FULL" && (
              <div className="mb-3">
                <label className="label" htmlFor="pos-part">
                  Pay now (optional)
                </label>
                <input
                  id="pos-part"
                  className={cn("input h-10", fe.partAmount && "input-error")}
                  inputMode="decimal"
                  value={partAmount}
                  onChange={(e) => {
                    setPartAmount(e.target.value);
                    setMode(Number(e.target.value) > 0 ? "PART" : "CREDIT"); // some money now, the rest on credit
                  }}
                  placeholder="0"
                />
                {fe.partAmount ? <p className="field-error">{fe.partAmount}</p> : <p className="mt-1 text-xs text-slate-500">{customer?.winga ? "The rest is paid within 3 days." : "The rest is paid later."}</p>}
              </div>
            )}

            {mode !== "CREDIT" && (
              <>
                <p className="label">Paid by</p>
                {locAccounts.length > 0 ? (
                  <AccountButtons accounts={locAccounts} value={account?.id ?? ""} onChange={setAccountPick} />
                ) : (
                  <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Payment method">
                    {PAYMENT_METHODS.map((m) => (
                      <button key={m.value} type="button" role="radio" aria-checked={method === m.value} onClick={() => setMethodPick(m.value)} className={cn("rounded-lg border px-2 py-2 text-sm font-medium transition", method === m.value ? "border-navy-600 bg-navy-50 text-navy-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                )}
                {method !== "CASH" && <input className="input mt-2.5" placeholder="Transaction reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} aria-label="Payment reference" />}
              </>
            )}
            {(fe.method || fe.payment || fe.accountId) && <p className="field-error">{fe.method ?? fe.payment ?? fe.accountId}</p>}

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
              {saleError ? (
                <p role="alert" className="mt-2 text-center text-sm font-medium text-brand-red-dark">
                  {saleError}
                </p>
              ) : (
                !canSubmit && <p className="hint text-center">{problems[0]}</p>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* Mobile / tablet: the total and the button are always in reach */}
      <div className="fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-30 lg:bottom-0 border-t border-line bg-white/95 px-4 py-3 shadow-[0_-4px_12px_rgba(15,27,45,0.08)] backdrop-blur lg:left-[15.5rem] xl:hidden">
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => document.getElementById("pos-cart")?.scrollIntoView({ behavior: "smooth" })}>
            <p className={cn("text-xs", saleError ? "font-medium text-brand-red-dark" : "text-slate-500")} role={saleError ? "alert" : undefined}>
              {saleError ?? `${cartCount} item${cartCount === 1 ? "" : "s"}${!canSubmit ? ` · ${problems[0]}` : " · tap to review"}`}
            </p>
            <p className="truncate text-lg font-bold text-slate-900">{fmt(total)}</p>
          </button>
          <SubmitButton pendingLabel="Completing…" className="btn-primary min-h-12 px-6 text-base">
            Complete sale
          </SubmitButton>
        </div>
      </div>
      <SaleDoneModal saleId={doneId} currency={currency} onNewSale={newSale} onLoaded={(sd) => sd.customerId && sd.customerSummary && refreshCustomer(sd.customerId, sd.customerSummary)} />
    </form>
  );
}
