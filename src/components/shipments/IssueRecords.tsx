"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { ImageOff, PackageCheck, PackageX, Tag, Trash2, X } from "lucide-react";
import { Alert } from "@/components/ui";
import { SubmitButton } from "@/components/FormBits";
import type { ActionState } from "@/lib/action";
import type { IssueView } from "@/lib/shipments/issue-view";
import { fmtQty, qtyText, type UnitMode } from "@/lib/qty";
import { cn } from "@/lib/utils";

type Action = "FOUND" | "NOT_DELIVERED" | "WRITE_OFF" | "KEEP" | "DISCOUNT_SELL" | "DISMISS";
type Run = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** What each choice is called, what it does (said plainly before the owner confirms) and how its button looks. */
const CHOICES: Record<Action, { label: string; icon: typeof PackageCheck; title: string; help: string; confirm: string; reason: "required" | "optional"; tone: "good" | "warn" | "danger" }> = {
  FOUND: { label: "Found it", icon: PackageCheck, title: "The pieces were found", help: "They go into stock now, with a stock receipt, under this order.", confirm: "Return to stock", reason: "optional", tone: "good" },
  NOT_DELIVERED: { label: "Not delivered", icon: PackageX, title: "The supplier never delivered them", help: "Nothing is added to stock. The shortage is recorded and you stop owing the supplier for these pieces.", confirm: "Confirm shortage", reason: "required", tone: "warn" },
  DISCOUNT_SELL: { label: "Sell at a discount", icon: Tag, title: "They can still be sold, cheaper", help: "They go back on sale as a separate product, “(damaged packaging)”, at the price you set. The normal product keeps its normal price, so the two can never be mixed up at the till.", confirm: "Put on sale", reason: "optional", tone: "good" },
  WRITE_OFF: { label: "Write off", icon: Trash2, title: "They cannot be sold", help: "They are thrown away for good. They stay in the history but never go back on the shelf.", confirm: "Write off", reason: "required", tone: "danger" },
  KEEP: { label: "Keep in stock", icon: PackageCheck, title: "Accept the extra pieces", help: "They are already in stock. This records that you accepted them.", confirm: "Keep in stock", reason: "optional", tone: "good" },
  DISMISS: { label: "Remove from list", icon: X, title: "Remove this from the list", help: "Use this when the record is a mistake (for example a wrong count). Stock and money do not change. It is not deleted: it stays in the history with your reason.", confirm: "Remove from list", reason: "required", tone: "danger" },
};
const OPTIONS: Record<IssueView["kind"], Action[]> = { MISSING: ["FOUND", "NOT_DELIVERED"], DAMAGED: ["DISCOUNT_SELL", "WRITE_OFF"], EXTRA: ["KEEP"] };

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const BTN = { good: "btn-primary", warn: "btn-secondary", danger: "btn-secondary" } as const;

/** Writes a number of pieces the way the person chose to see quantities: cartons, or pieces. */
const qty = (r: IssueView, n: number, mode: UnitMode) => qtyText(n, r.pack, r.unit, mode).main;
/** the same, with the pieces beside the cartons so a sensitive decision shows exactly what it moves ("6 CTN (24 PCS)") */
const exact = (r: IssueView, n: number, mode: UnitMode) => (r.pack && mode === "ctn" ? `${qty(r, n, mode)} (${fmtQty(n)} ${r.unit})` : qty(r, n, mode));

function describe(r: IssueView, mode: UnitMode): string {
  const f = (n: number) => qty(r, n, mode);
  if (r.typeLabel === "Damaged product") return `${f(r.total)} arrived damaged and were taken off the shelf count.`;
  if (r.typeLabel === "Listed but not shipped") return `${f(r.expected)} ordered. Nothing arrived.`;
  if (r.typeLabel === "Missing product") return `${f(r.expected)} ordered, ${f(r.arrived)} arrived.`;
  if (r.typeLabel === "Product not on the order") return `${f(r.total)} arrived that are not on the order.`;
  return `${f(r.total)} more arrived than the ${f(r.expected)} ordered.`;
}

function historyText(h: IssueView["history"][number], r: IssueView, mode: UnitMode): string {
  const f = qty(r, h.quantity, mode);
  switch (h.action) {
    case "FOUND":
      return `Found ${f} and put back in stock${h.receiptNo ? ` (receipt ${h.receiptNo})` : ""}`;
    case "NOT_DELIVERED":
      return `Confirmed ${f} were not delivered${h.newOrderNo ? `, added to new order ${h.newOrderNo}` : ""}`;
    case "WRITE_OFF":
      return `Wrote off ${f}`;
    case "DISCOUNT_SELL":
      return `Put ${f} on sale at a discount${h.variantName ? ` as “${h.variantName}”` : ""}${h.discountPrice ? ` at ${nf.format(h.discountPrice * (r.pack?.factor ?? 1))} per ${r.pack?.symbol ?? r.unit}` : ""}`;
    case "KEEP":
      return `Kept ${f} in stock`;
    default:
      return `Removed ${f} from the list`;
  }
}

function DecisionForm({ r, choice, action, onDone, mode, currencySymbol }: { r: IssueView; choice: Action; action: Run; onDone: () => void; mode: UnitMode; currencySymbol: string }) {
  const [state, formAction] = useActionState(action, {});
  const [submissionKey] = useState(() => crypto.randomUUID());
  const c = CHOICES[choice];
  const fe = state.fieldErrors ?? {};
  const factor = r.pack?.factor ?? 1;
  // start in cartons when what is open divides into whole cartons, otherwise in pieces
  const wholeCartons = r.pack ? r.open / factor : NaN;
  const startInCartons = Boolean(r.pack) && Number.isInteger(wholeCartons);
  const [amount, setAmount] = useState(startInCartons ? String(wholeCartons) : String(Number(r.open.toFixed(3))));
  const [unit, setUnit] = useState<"pack" | "base">(startInCartons ? "pack" : "base");
  const [price, setPrice] = useState("");
  const [newOrder, setNewOrder] = useState(false);

  useEffect(() => {
    if (!state.ok) return;
    const t = setTimeout(onDone, 1800);
    return () => clearTimeout(t);
  }, [state.ok]); // eslint-disable-line react-hooks/exhaustive-deps

  // exactly what will happen, worked out from what is typed, before anything is saved
  const typed = Number(amount.replace(/,/g, ""));
  const base = unit === "pack" ? typed * factor : typed;
  const valid = Number.isFinite(base) && base > 0 && base <= r.open + 1e-9;
  const value = r.unitCost !== null && valid ? base * r.unitCost : null;
  const money = (n: number) => `${currencySymbol} ${nf.format(n)}`;
  const priceNum = Number(price.replace(/,/g, ""));
  const happens = !valid
    ? `Enter a quantity between 0 and ${qty(r, r.open, mode)}.`
    : choice === "FOUND"
      ? `${exact(r, base, mode)} go back into stock now, with a stock receipt.`
      : choice === "NOT_DELIVERED"
        ? `No stock is added. ${exact(r, base, mode)} are recorded as a shortage${value !== null ? `, and what you owe the supplier drops by ${money(value)}` : ""}.${newOrder ? " A new purchase order for them is created." : ""}`
        : choice === "WRITE_OFF"
          ? `${exact(r, base, mode)} are thrown away for good${value !== null ? ` (cost ${money(value)})` : ""}. They never go back on the shelf.`
          : choice === "DISCOUNT_SELL"
            ? `${exact(r, base, mode)} go on sale as “${r.productName} (damaged packaging)”${Number.isFinite(priceNum) && priceNum > 0 ? ` at ${money(priceNum)} per ${r.pack?.symbol ?? r.unit}` : ""}. The normal product is not touched.`
            : choice === "KEEP"
              ? `${exact(r, base, mode)} stay in stock as they are.`
              : `${exact(r, base, mode)} are removed from this list. Stock and money do not change.`;

  return (
    <form action={formAction} className={cn("mt-3 space-y-3 rounded-xl border p-4", c.tone === "danger" ? "border-brand-red/40 bg-brand-red-soft/30" : "border-line bg-slate-50/60")}>
      <input type="hidden" name="shipmentId" value={r.shipmentId} />
      <input type="hidden" name="shipmentItemId" value={r.shipmentItemId} />
      <input type="hidden" name="kind" value={r.kind} />
      <input type="hidden" name="action" value={choice} />
      <input type="hidden" name="submissionKey" value={submissionKey} />
      <div>
        <p className="text-sm font-semibold text-slate-900">{c.title}</p>
        <p className="text-sm text-slate-600">{c.help}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-[170px_1fr]">
        <div>
          <label className="label" htmlFor={`q-${r.key}`}>How many?</label>
          <div className="flex gap-2">
            <input id={`q-${r.key}`} name="quantity" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={cn("input min-w-0", fe.quantity && "input-error")} />
            {r.pack && (
              <select name="qtyUnit" value={unit} onChange={(e) => setUnit(e.target.value as "pack" | "base")} className="input w-auto" aria-label="Unit">
                <option value="pack">{r.pack.symbol}</option>
                <option value="base">{r.unit}</option>
              </select>
            )}
          </div>
          {fe.quantity ? <p className="field-error">{fe.quantity}</p> : <p className="hint">{qty(r, r.open, mode)} are open. You can decide part of it.</p>}
        </div>
        <div>
          <label className="label" htmlFor={`n-${r.key}`}>{c.reason === "required" ? "Reason (required)" : "Note (optional)"}</label>
          <input id={`n-${r.key}`} name="note" className={cn("input", fe.note && "input-error")} placeholder={choice === "NOT_DELIVERED" ? "e.g. Supplier confirmed they shipped less" : choice === "WRITE_OFF" ? "e.g. Leaking, cannot be sold" : choice === "DISMISS" ? "e.g. Wrong count by the shop, nothing is missing" : "e.g. Found in the back store"} />
          {fe.note && <p className="field-error">{fe.note}</p>}
        </div>
      </div>

      {choice === "DISCOUNT_SELL" && (
        <div className="sm:max-w-xs">
          <label className="label" htmlFor={`p-${r.key}`}>New selling price per {r.pack?.symbol ?? r.unit} ({currencySymbol})</label>
          <input id={`p-${r.key}`} name="discountPrice" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className={cn("input", fe.discountPrice && "input-error")} placeholder="e.g. 70000" />
          {fe.discountPrice ? <p className="field-error">{fe.discountPrice}</p> : r.normalPrice ? <p className="hint">Normal price: {money(r.normalPrice)} per {r.pack?.symbol ?? r.unit}.</p> : null}
        </div>
      )}
      {choice === "NOT_DELIVERED" && (
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" name="newOrder" checked={newOrder} onChange={(e) => setNewOrder(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-400" />
          <span>Also put them on a new purchase order, so they are expected again.</span>
        </label>
      )}

      <div className="rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-slate-800" aria-live="polite">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">What will happen</p>
        <p className="mt-0.5">{happens}</p>
      </div>

      {state.error && !fe.quantity && !fe.note && !fe.discountPrice && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.message}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton pendingLabel="Saving…" className={c.tone === "danger" ? "btn-danger btn-sm" : "btn-primary btn-sm"}>
          {c.confirm}
        </SubmitButton>
        <button type="button" className="btn-secondary btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function RecordRow({ r, canAct, closed, action, mode, currencySymbol }: { r: IssueView; canAct: boolean; closed: boolean; action: Run; mode: UnitMode; currencySymbol: string }) {
  const [choice, setChoice] = useState<Action | null>(null);
  const done = r.open === 0;
  const status = done ? { cls: "badge-green", label: "Resolved" } : closed ? { cls: "badge-gray", label: "Closed with a note" } : r.resolved > 0 ? { cls: "badge-yellow", label: "Partly resolved" } : { cls: "badge-red", label: "Under investigation" };
  const options = OPTIONS[r.kind];
  const dismissed = r.history.length > 0 && r.history.every((h) => h.action === "DISMISS");

  return (
    <li className={cn("px-4 py-4 sm:px-5", done && "bg-slate-50/40 opacity-75")}>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1.3fr)_9.5rem] lg:gap-5">
        <div className="flex min-w-0 gap-3">
          <Link href={`/products/${r.productId}`} className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-white" aria-label={r.productName}>
            {r.imageV ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/product-image/${r.productId}?size=thumb&v=${r.imageV}`} alt="" loading="lazy" className="h-full w-full object-contain" />
            ) : (
              <ImageOff size={18} className="text-slate-300" />
            )}
          </Link>
          <div className="min-w-0">
            <Link href={`/products/${r.productId}`} className="block truncate text-sm font-semibold text-slate-900 hover:text-navy-700 hover:underline">
              {r.productName}
            </Link>
            <p className="truncate text-xs text-slate-500">
              <span className="font-mono">{r.sku}</span> ·{" "}
              <Link href={`/shipments/${r.shipmentId}`} className="text-navy-700 hover:underline">
                {r.shipmentNo}
              </Link>
              {r.supplierName && <> · {r.supplierName}</>}
            </p>
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={status.cls}>{dismissed && done ? "Removed" : status.label}</span>
            <span className="badge-gray">{r.typeLabel}</span>
          </div>
          <p className="mt-1.5 text-sm text-slate-700">{describe(r, mode)}</p>
          {r.reported && <p className="text-xs text-slate-500">Reported {r.reported}</p>}
        </div>

        <div className="lg:text-right">
          <p className="text-2xl font-bold leading-none tracking-tight text-slate-900">{qty(r, r.open, mode)}</p>
          <p className="mt-1 text-xs text-slate-500">{done ? "all decided" : r.resolved > 0 ? `open, of ${qty(r, r.total, mode)}` : "under investigation"}</p>
        </div>
      </div>

      {canAct && !done && !closed && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line/70 pt-3">
          <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Decide</span>
          {options.map((o) => {
            const Icon = CHOICES[o].icon;
            return (
              <button key={o} type="button" className={cn(BTN[CHOICES[o].tone], "btn-sm", choice === o && "ring-2 ring-navy-500/40")} onClick={() => setChoice(choice === o ? null : o)}>
                <Icon size={14} /> {CHOICES[o].label}
              </button>
            );
          })}
          <button type="button" className={cn("ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-brand-red-soft hover:text-brand-red-dark", choice === "DISMISS" && "bg-brand-red-soft text-brand-red-dark")} onClick={() => setChoice(choice === "DISMISS" ? null : "DISMISS")}>
            <X size={14} /> Remove from list
          </button>
        </div>
      )}
      {choice && <DecisionForm key={choice} r={r} choice={choice} action={action} onDone={() => setChoice(null)} mode={mode} currencySymbol={currencySymbol} />}

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer select-none text-xs font-medium text-slate-500 hover:text-slate-800">History ({r.history.length + 1})</summary>
        <ol className="mt-2 space-y-1.5 border-l border-line pl-4">
          <li className="text-slate-600">
            <span className="font-medium text-slate-800">Reported</span>
            {r.reported ? ` · ${r.reported}` : ""}: {describe(r, mode)}
          </li>
          {r.history.map((h, i) => (
            <li key={i} className="text-slate-600">
              <span className="font-medium text-slate-800">{historyText(h, r, mode)}</span> · {h.by}, {h.at}
              {h.note && <span className="block text-xs text-slate-500">“{h.note}”</span>}
            </li>
          ))}
        </ol>
      </details>
    </li>
  );
}

/**
 * The problem products of an order as a clean list: product, what happened, how much, and a clear row of choices for each one.
 * People who cannot decide (the shop) see the same list without the buttons.
 */
export default function IssueRecords({ records, canAct, closed = false, action, mode = "ctn", currencySymbol = "TSh" }: { records: IssueView[]; canAct: boolean; /** the investigation was closed with a note instead of deciding each product */ closed?: boolean; action: Run; /** the CTN | PCS switch */ mode?: UnitMode; currencySymbol?: string }) {
  // what still needs a decision first, decided ones last
  const sorted = [...records].sort((a, b) => Number(a.open === 0) - Number(b.open === 0));
  return (
    <div>
      <div className="hidden border-b border-line bg-slate-50/60 px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 lg:grid lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1.3fr)_9.5rem] lg:gap-5" aria-hidden>
        <span>Product</span>
        <span>What happened</span>
        <span className="text-right">Quantity</span>
      </div>
      <ul className="divide-y divide-slate-100">
        {sorted.map((r) => (
          <RecordRow key={r.key} r={r} canAct={canAct} closed={closed} action={action} mode={mode} currencySymbol={currencySymbol} />
        ))}
      </ul>
    </div>
  );
}
