"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { Alert } from "@/components/ui";
import { SubmitButton } from "@/components/FormBits";
import type { ActionState } from "@/lib/action";
import type { IssueView } from "@/lib/shipments/issue-view";
import { qtyText, type UnitMode } from "@/lib/qty";
import { cn } from "@/lib/utils";

type Action = "FOUND" | "NOT_DELIVERED" | "WRITE_OFF" | "KEEP";

/** What each choice does, in plain words, shown right before the owner confirms. */
const CHOICES: Record<Action, { label: string; title: string; help: string; confirm: string; reasonRequired: boolean; primary?: boolean }> = {
  FOUND: { label: "Found it", title: "The pieces were found", help: "They go into stock now, with new item numbers, under this order.", confirm: "Return to stock", reasonRequired: false, primary: true },
  NOT_DELIVERED: { label: "Not delivered", title: "The supplier never delivered them", help: "Nothing is added to stock. The shortage is recorded and you stop owing the supplier for these pieces.", confirm: "Confirm shortage", reasonRequired: true },
  WRITE_OFF: { label: "Write off", title: "They cannot be sold", help: "They are thrown away. They stay in the history but never go back on the shelf.", confirm: "Write off", reasonRequired: true },
  KEEP: { label: "Keep in stock", title: "Accept the extra pieces", help: "They are already in stock. This records that you accepted them.", confirm: "Keep", reasonRequired: false, primary: true },
};
const OPTIONS: Record<IssueView["kind"], Action[]> = { MISSING: ["FOUND", "NOT_DELIVERED"], DAMAGED: ["WRITE_OFF"], EXTRA: ["KEEP"] };

const show = (r: IssueView, n: number, mode: UnitMode) => qtyText(n, r.pack, r.unit, mode);

function DecisionForm({ r, choice, action, onDone, mode }: { r: IssueView; choice: Action; action: (prev: ActionState, fd: FormData) => Promise<ActionState>; onDone: () => void; mode: UnitMode }) {
  const [state, formAction] = useActionState(action, {});
  const [submissionKey] = useState(() => crypto.randomUUID());
  const fe = state.fieldErrors ?? {};
  const c = CHOICES[choice];
  // cartons first: start in cartons when what is open divides into whole cartons, otherwise in pieces
  const wholeCartons = r.pack ? r.open / r.pack.factor : NaN;
  const startInCartons = Boolean(r.pack) && Number.isInteger(wholeCartons);
  useEffect(() => {
    if (!state.ok) return;
    const t = setTimeout(onDone, 1800);
    return () => clearTimeout(t);
  }, [state.ok]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <form action={formAction} className="mt-3 space-y-3 rounded-xl border border-line bg-slate-50/60 p-4">
      <input type="hidden" name="shipmentId" value={r.shipmentId} />
      <input type="hidden" name="shipmentItemId" value={r.shipmentItemId} />
      <input type="hidden" name="kind" value={r.kind} />
      <input type="hidden" name="action" value={choice} />
      <input type="hidden" name="submissionKey" value={submissionKey} />
      <div>
        <p className="text-sm font-semibold text-slate-900">{c.title}</p>
        <p className="text-sm text-slate-600">{c.help}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
        <div>
          <label className="label" htmlFor={`q-${r.key}`}>How many?</label>
          <div className="flex gap-2">
            <input id={`q-${r.key}`} name="quantity" inputMode="decimal" defaultValue={startInCartons ? String(wholeCartons) : String(Number(r.open.toFixed(3)))} className={cn("input min-w-0", fe.quantity && "input-error")} />
            {r.pack && (
              <select name="qtyUnit" defaultValue={startInCartons ? "pack" : "base"} className="input w-auto" aria-label="Unit">
                <option value="pack">{r.pack.symbol}</option>
                <option value="base">{r.unit}</option>
              </select>
            )}
          </div>
          {fe.quantity ? <p className="field-error">{fe.quantity}</p> : <p className="hint">{show(r, r.open, mode).main} open. Fewer is fine: the rest stays under investigation.</p>}
        </div>
        <div>
          <label className="label" htmlFor={`n-${r.key}`}>{c.reasonRequired ? "Reason" : "Note (optional)"}</label>
          <input id={`n-${r.key}`} name="note" className={cn("input", fe.note && "input-error")} placeholder={choice === "NOT_DELIVERED" ? "e.g. Supplier confirmed they shipped less" : choice === "WRITE_OFF" ? "e.g. Leaking, cannot be sold" : "e.g. Found in the back store"} />
          {fe.note && <p className="field-error">{fe.note}</p>}
        </div>
      </div>
      {choice === "NOT_DELIVERED" && (
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" name="newOrder" className="mt-0.5 h-4 w-4 rounded border-slate-400" />
          <span>Also put them on a new purchase order, so they are expected again.</span>
        </label>
      )}
      {state.error && !fe.quantity && !fe.note && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.message}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton pendingLabel="Saving…" className={c.primary ? "btn-primary btn-sm" : "btn-danger btn-sm"}>
          {c.confirm}
        </SubmitButton>
        <button type="button" className="btn-secondary btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function RecordCard({ r, canAct, closed, action, mode }: { r: IssueView; canAct: boolean; closed: boolean; action: (prev: ActionState, fd: FormData) => Promise<ActionState>; mode: UnitMode }) {
  const [choice, setChoice] = useState<Action | null>(null);
  const done = r.open === 0;
  const status = done ? { cls: "badge-green", label: "Resolved" } : closed ? { cls: "badge-gray", label: "Closed with a note" } : r.resolved > 0 ? { cls: "badge-yellow", label: "Partly resolved" } : { cls: "badge-red", label: "Under investigation" };
  const options = OPTIONS[r.kind];
  return (
    <li className={cn("px-4 py-4 sm:px-5", done && "opacity-70")}>
      <div className="flex flex-wrap items-start gap-4">
        <Link href={`/products/${r.productId}`} className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-white" aria-label={r.productName}>
          {r.imageV ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/product-image/${r.productId}?size=thumb&v=${r.imageV}`} alt="" loading="lazy" className="h-full w-full object-contain" />
          ) : (
            <ImageOff size={18} className="text-slate-300" />
          )}
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={`/products/${r.productId}`} className="text-sm font-semibold text-slate-900 hover:text-navy-700 hover:underline">
              {r.productName}
            </Link>
            <span className={status.cls}>{status.label}</span>
            <span className="badge-gray">{r.typeLabel}</span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            <span className="font-mono">{r.sku}</span> ·{" "}
            <Link href={`/shipments/${r.shipmentId}`} className="text-navy-700 hover:underline">
              {r.shipmentNo}
            </Link>
            {r.supplierName && <> · {r.supplierName}</>}
          </p>
          <p className="mt-1 text-sm text-slate-700">{r.description}</p>
          {r.reported && <p className="text-xs text-slate-500">Reported {r.reported}</p>}
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold leading-none tracking-tight text-slate-900">
            {show(r, r.open, mode).main}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {done ? "all decided" : r.resolved > 0 ? `still open of ${show(r, r.total, mode).main}` : "under investigation"}
            {show(r, r.open, mode).pieces && !done && <span className="block">{show(r, r.open, mode).pieces}</span>}
          </p>
        </div>
      </div>

      {canAct && !done && !closed && (
        <div className="mt-3 flex flex-wrap gap-2">
          {options.map((o) => (
            <button key={o} type="button" className={cn("btn-sm", CHOICES[o].primary ? "btn-primary" : "btn-secondary", choice === o && "ring-2 ring-navy-500/40")} onClick={() => setChoice(choice === o ? null : o)}>
              {CHOICES[o].label}
            </button>
          ))}
        </div>
      )}
      {choice && <DecisionForm key={choice} r={r} choice={choice} action={action} onDone={() => setChoice(null)} mode={mode} />}

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer select-none text-xs font-medium text-slate-500 hover:text-slate-800">History ({r.history.length + 1})</summary>
        <ol className="mt-2 space-y-1.5 border-l border-line pl-4">
          <li className="text-slate-600">
            <span className="font-medium text-slate-800">Reported</span>
            {r.reported ? ` · ${r.reported}` : ""}: {r.description}
          </li>
          {r.history.map((h, i) => (
            <li key={i} className="text-slate-600">
              <span className="font-medium text-slate-800">{h.text}</span> · {h.by}, {h.at}
              {h.note && <span className="block text-xs text-slate-500">“{h.note}”</span>}
            </li>
          ))}
        </ol>
      </details>
    </li>
  );
}

/**
 * The problem products of an order, one card each, with the choices the owner has for that kind of problem.
 * People who cannot decide (the shop) see the same cards without the buttons.
 */
export default function IssueRecords({ records, canAct, closed = false, action, mode = "ctn" }: { records: IssueView[]; canAct: boolean; /** the CTN | PCS switch */ mode?: UnitMode; /** the investigation was closed with a note instead of deciding each product */ closed?: boolean; action: (prev: ActionState, fd: FormData) => Promise<ActionState> }) {
  // what still needs a decision first, decided ones last
  const sorted = [...records].sort((a, b) => Number(a.open === 0) - Number(b.open === 0));
  return (
    <ul className="divide-y divide-slate-100">
      {sorted.map((r) => (
        <RecordCard key={r.key} r={r} canAct={canAct} closed={closed} action={action} mode={mode} />
      ))}
    </ul>
  );
}
