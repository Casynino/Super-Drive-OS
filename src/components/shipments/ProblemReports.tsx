"use client";

import { useActionState, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, ImageOff, PackageCheck, Plus, Search, Tag, Trash2, TriangleAlert, X } from "lucide-react";
import Modal from "@/components/Modal";
import { Alert } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import { qtyText, type Pack } from "@/lib/qty";
import { cn } from "@/lib/utils";

export type ReportProduct = { id: string; name: string; sku: string; imageV: number | null; available: number; baseSymbol: string; pack: Pack | null };
export type ProblemRow = {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  imageV: number | null;
  baseSymbol: string;
  pack: Pack | null;
  normalPrice: number | null;
  kind: "DAMAGED" | "MISSING";
  quantity: number;
  note: string;
  /** the stock adjustment, or the return number, it comes from; and the sale of a returned one */
  reference: string;
  saleNo: string | null;
  reportedBy: string;
  reportedAt: string;
  action: "FOUND" | "WRITE_OFF" | "DISCOUNT_SELL" | "KEEP" | "NOT_DELIVERED" | "DISMISS" | null;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  variantName: string | null;
  discountPrice: number | null;
};
type Run = (prev: ActionState, fd: FormData) => Promise<ActionState>;
const initial: ActionState = {};
const KIND_LABEL = { DAMAGED: "Damaged", MISSING: "Lost" } as const;
const OUTCOME: Record<string, string> = { FOUND: "Found and returned to stock", WRITE_OFF: "Written off", DISCOUNT_SELL: "Put on sale at a discount" };
const nf = new Intl.NumberFormat("en-US");

function ago(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
const say = (pack: Pack | null, base: number, sym: string) => qtyText(base, pack, sym).main;
const img = (id: string, v: number | null) => (v ? `/api/product-image/${id}?size=thumb&v=${v}` : null);

function Thumb({ id, v, size = 12 }: { id: string; v: number | null; size?: number }) {
  const src = img(id, v);
  return (
    <span className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-gradient-to-b from-white to-slate-100", size === 12 ? "h-12 w-12" : "h-14 w-14")}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" className="h-full w-full object-contain" />
      ) : (
        <ImageOff size={18} className="text-slate-300" />
      )}
    </span>
  );
}

// ───────────── Report a problem (pop-up) ─────────────

function ReportForm({ products, action, onDone }: { products: ReportProduct[]; action: Run; onDone: () => void }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, initial);
  const [picked, setPicked] = useState<ReportProduct | null>(null);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<"DAMAGED" | "MISSING">("DAMAGED");
  const [ctn, setCtn] = useState("");
  const [pcs, setPcs] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  const fe = state.fieldErrors ?? {};
  const list = useMemo(() => {
    const s = search.trim().toLowerCase();
    return products.filter((p) => !s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s));
  }, [products, search]);
  const num = (v: string) => (v.trim() === "" ? 0 : Number(v));
  const total = picked ? (picked.pack ? num(ctn) * picked.pack.factor : 0) + num(pcs) : 0;
  const clean = (v: string) => v.replace(/[^0-9.]/g, "");

  if (state.ok) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-emerald-500 text-[#ffffff]">
          <CircleCheck size={30} />
        </span>
        <p className="text-lg font-semibold text-slate-900">{state.message}</p>
        <button
          type="button"
          className="btn-primary h-11 px-6"
          onClick={() => {
            router.refresh();
            onDone();
          }}
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col" noValidate>
      <input type="hidden" name="submissionKey" value={key} />
      <input type="hidden" name="productId" value={picked?.id ?? ""} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="qtyUnit" value="base" />
      <input type="hidden" name="quantity" value={total > 0 ? String(Number(total.toFixed(3))) : ""} />
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h2 className="text-base font-semibold text-slate-900">{picked ? "What happened?" : "Which product?"}</h2>
        <button type="button" onClick={onDone} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full text-slate-500 hover:bg-slate-100">
          <X size={16} />
        </button>
      </div>

      {!picked ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-line px-5 py-3">
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="input h-10 pl-9" placeholder="Search a product" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus aria-label="Search a product" />
            </div>
          </div>
          <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
            {list.length === 0 && <li className="px-5 py-8 text-center text-sm text-slate-500">No product matches.</li>}
            {list.map((p) => (
              <li key={p.id}>
                <button type="button" className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-slate-50" onClick={() => setPicked(p)}>
                  <Thumb id={p.id} v={p.imageV} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-slate-900">{p.name}</span>
                    <span className="block text-xs text-slate-500">{p.sku}</span>
                  </span>
                  <span className="shrink-0 text-right text-sm font-medium text-slate-700">
                    {say(p.pack, p.available, p.baseSymbol)}
                    <span className="block text-[11px] font-normal text-slate-500">on the shelf</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
            <Thumb id={picked.id} v={picked.imageV} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-slate-900">{picked.name}</span>
              <span className="block text-xs text-slate-500">{say(picked.pack, picked.available, picked.baseSymbol)} on the shelf</span>
            </span>
            <button type="button" className="text-sm font-medium text-navy-700 hover:underline" onClick={() => setPicked(null)}>
              Change
            </button>
          </div>

          <div>
            <p className="label">What is wrong?</p>
            <div className="grid grid-cols-2 gap-2">
              {(["DAMAGED", "MISSING"] as const).map((k) => (
                <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={cn("h-12 rounded-xl border text-sm font-semibold transition", kind === k ? "border-navy-700 bg-navy-700 text-[#ffffff]" : "border-line bg-white text-slate-700 hover:border-navy-200")}>
                  {k === "DAMAGED" ? "Damaged" : "Lost, cannot find"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="label">How many?</p>
            <div className="flex items-center gap-2">
              {picked.pack && (
                <>
                  <input className="input h-11 w-20 text-center text-lg font-semibold tabular-nums" inputMode="numeric" placeholder="0" value={ctn} onChange={(e) => setCtn(clean(e.target.value))} aria-label="Cartons" />
                  <span className="w-10 text-sm font-medium text-slate-500">{picked.pack.symbol}</span>
                </>
              )}
              <input className="input h-11 w-20 text-center text-lg font-semibold tabular-nums" inputMode="numeric" placeholder="0" value={pcs} onChange={(e) => setPcs(clean(e.target.value))} aria-label="Pieces" />
              <span className="w-10 text-sm font-medium text-slate-500">{picked.baseSymbol}</span>
            </div>
            {total > 0 && <p className="mt-1.5 text-xs text-slate-500">{nf.format(total)} {picked.baseSymbol} will leave the shelf now.</p>}
            {fe.quantity && <p className="field-error">{fe.quantity}</p>}
          </div>

          <div>
            <label className="label" htmlFor="pr-note">
              What happened?
            </label>
            <input id="pr-note" name="note" className={cn("input h-11", fe.note && "input-error")} placeholder={kind === "DAMAGED" ? "e.g. Fell from the pallet, bottles leaking" : "e.g. Not on the shelf after counting"} autoComplete="off" maxLength={300} />
            {fe.note && <p className="field-error">{fe.note}</p>}
          </div>
          {state.error && !fe.quantity && !fe.note && <Alert>{state.error}</Alert>}
        </div>
      )}

      {picked && (
        <div className="border-t border-line px-5 py-3.5">
          <button type="submit" disabled={pending || total <= 0} className="btn-primary h-12 w-full text-base">
            {pending ? "Reporting…" : "Report it"}
          </button>
          <p className="mt-2 text-center text-xs text-slate-500">The pieces leave the sellable stock now and stay under investigation until you decide.</p>
        </div>
      )}
    </form>
  );
}

// ───────────── One open problem and its decisions ─────────────

function Decision({ r, action, currencySymbol }: { r: ProblemRow; action: Run; currencySymbol: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    async (prev: ActionState, fd: FormData) => {
      const out = await action(prev, fd);
      if (out.ok) router.refresh();
      return out;
    },
    initial,
  );
  const [choice, setChoice] = useState<"FOUND" | "WRITE_OFF" | "DISCOUNT_SELL" | null>(null);
  const fe = state.fieldErrors ?? {};
  const options = [
    { k: "FOUND" as const, label: r.kind === "MISSING" ? "Found it" : "Not damaged", icon: PackageCheck, tone: "good" },
    ...(r.kind === "DAMAGED" ? [{ k: "DISCOUNT_SELL" as const, label: "Sell at a discount", icon: Tag, tone: "good" }] : []),
    { k: "WRITE_OFF" as const, label: "Write off", icon: Trash2, tone: "danger" },
  ];
  if (state.ok) return <p className="mt-3 flex items-center gap-2 text-sm font-medium text-emerald-700"><CircleCheck size={16} /> {state.message}</p>;
  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button key={o.k} type="button" aria-pressed={choice === o.k} onClick={() => setChoice(choice === o.k ? null : o.k)} className={cn("inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold transition", choice === o.k ? (o.tone === "danger" ? "border-brand-red bg-brand-red-soft text-brand-red-dark" : "border-navy-700 bg-navy-700 text-[#ffffff]") : "border-line bg-white text-slate-700 hover:border-navy-200")}>
            <o.icon size={15} /> {o.label}
          </button>
        ))}
      </div>
      {choice && (
        <form action={formAction} className="mt-3 space-y-3 rounded-xl bg-slate-50 p-3" noValidate>
          <input type="hidden" name="problemId" value={r.id} />
          <input type="hidden" name="action" value={choice} />
          <p className="text-sm text-slate-600">
            {choice === "FOUND" && (r.kind === "MISSING" ? "The pieces turned up. They go back on the shelf now." : "They are fine after all, or it was a mistake. They go back on the shelf now.")}
            {choice === "WRITE_OFF" && "They cannot be sold. They are thrown away for good and stay in the history, never on the shelf."}
            {choice === "DISCOUNT_SELL" && "They can still be sold, cheaper, as a separate product “(damaged packaging)”. The normal product keeps its normal price."}
          </p>
          {choice === "DISCOUNT_SELL" && (
            <div>
              <label className="label" htmlFor={`dp-${r.id}`}>
                New price per {r.pack ? r.pack.symbol : r.baseSymbol} ({currencySymbol})
                {r.normalPrice ? <span className="font-normal text-slate-500"> · normal {nf.format(r.normalPrice)}</span> : null}
              </label>
              <input id={`dp-${r.id}`} name="discountPrice" inputMode="numeric" className={cn("input h-11 max-w-[14rem]", fe.discountPrice && "input-error")} placeholder="0" autoComplete="off" />
              {fe.discountPrice && <p className="field-error">{fe.discountPrice}</p>}
            </div>
          )}
          <div>
            <label className="label" htmlFor={`nt-${r.id}`}>
              Reason {choice === "WRITE_OFF" ? "" : "(optional)"}
            </label>
            <input id={`nt-${r.id}`} name="note" className={cn("input h-11", fe.note && "input-error")} placeholder={choice === "WRITE_OFF" ? "e.g. Leaking, cannot be sold" : "e.g. Found in the back store"} autoComplete="off" maxLength={300} />
            {fe.note && <p className="field-error">{fe.note}</p>}
          </div>
          {state.error && <Alert>{state.error}</Alert>}
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className={cn("h-11 flex-1 rounded-xl text-sm font-semibold text-[#ffffff] transition disabled:opacity-60", choice === "WRITE_OFF" ? "bg-brand-red hover:bg-brand-red-dark" : "bg-navy-700 hover:bg-navy-800")}>
              {pending ? "Saving…" : choice === "FOUND" ? "Return to stock" : choice === "WRITE_OFF" ? "Write off" : "Put on sale"}
            </button>
            <button type="button" className="btn-secondary h-11" onClick={() => setChoice(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function ProblemReports({ open, decided, products, canReport, reportAction, decideAction, currencySymbol, title = "Reported at the warehouse", intro, emptyText = "Nothing reported by hand yet." }: { open: ProblemRow[]; decided: ProblemRow[]; products: ReportProduct[]; canReport: boolean; reportAction: Run; decideAction: Run; currencySymbol: string; /** the card's heading, its line when nothing is open, and the line when there is nothing at all */ title?: string; intro?: string; emptyText?: string }) {
  const [modal, setModal] = useState(false);
  if (!canReport && open.length === 0 && decided.length === 0) return null;
  return (
    <section className="card mb-4 overflow-hidden" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <p className="text-sm text-slate-500">
            {open.length > 0 ? `${open.length} product${open.length === 1 ? "" : "s"} to decide. Damaged or lost pieces are already off the shelf.` : (intro ?? "Damaged or lost goods you find on the shelf. They leave the sellable stock at once.")}
          </p>
        </div>
        {canReport && (
          <button type="button" className="btn-primary" onClick={() => setModal(true)}>
            <Plus size={16} /> Report a problem
          </button>
        )}
      </div>

      {open.length > 0 && (
        <ul className="divide-y divide-line">
          {open.map((r) => (
            <li key={r.id} className="px-4 py-4 sm:px-5">
              <div className="flex items-start gap-3">
                <Thumb id={r.productId} v={r.imageV} size={14} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold text-slate-900">{r.productName}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", r.kind === "DAMAGED" ? "bg-brand-red-soft text-brand-red-dark" : "bg-oil-soft text-yellow-800")}>{KIND_LABEL[r.kind]}</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {[r.sku, r.saleNo, r.reference].filter(Boolean).join(" · ")} · {r.saleNo ? "returned by" : "reported by"} {r.reportedBy} · {ago(r.reportedAt)}
                  </p>
                  <p className="mt-1 text-sm text-slate-700">{r.note}</p>
                </div>
                <p className="shrink-0 text-right text-lg font-bold tabular-nums text-slate-900">
                  {say(r.pack, r.quantity, r.baseSymbol)}
                  {r.pack && !Number.isInteger(r.quantity / r.pack.factor) ? null : r.pack ? <span className="block text-[11px] font-normal text-slate-500">{nf.format(r.quantity)} {r.baseSymbol}</span> : null}
                </p>
              </div>
              <Decision r={r} action={decideAction} currencySymbol={currencySymbol} />
            </li>
          ))}
        </ul>
      )}

      {decided.length > 0 && (
        <details className="border-t border-line">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-600 hover:text-slate-900 sm:px-5">Decided ({decided.length})</summary>
          <ul className="divide-y divide-line">
            {decided.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <Thumb id={r.productId} v={r.imageV} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {r.productName} <span className="font-normal text-slate-500">· {KIND_LABEL[r.kind]} · {say(r.pack, r.quantity, r.baseSymbol)}</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {OUTCOME[r.action ?? ""] ?? "Decided"}
                    {r.variantName ? ` as ${r.variantName}` : ""}
                    {r.discountPrice ? ` at ${nf.format(r.discountPrice)} ${currencySymbol} a piece` : ""} · {r.decidedBy} · {r.decidedAt ? ago(r.decidedAt) : ""}
                    {r.decisionNote ? ` · ${r.decisionNote}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}

      {open.length === 0 && decided.length === 0 && (
        <p className="flex items-center gap-2 px-4 py-5 text-sm text-slate-500 sm:px-5">
          <TriangleAlert size={15} className="shrink-0" /> {emptyText}
        </p>
      )}

      <Modal open={modal} onClose={() => setModal(false)} label="Report a problem">
        <ReportForm products={products} action={reportAction} onDone={() => setModal(false)} />
      </Modal>
    </section>
  );
}
