"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { ImageOff, Plus, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui";
import ProductPicker from "@/components/inventory/ProductPicker";
import type { ActionState } from "@/lib/action";
import type { PickerProduct } from "@/lib/inventory/types";
import { cn } from "@/lib/utils";

export type CountRow = {
  key: string;
  shipmentItemId: string | null;
  productId: string;
  name: string;
  sku: string;
  imageV: number | null;
  units: { id: string; name: string; symbol: string; factor: string }[];
  baseUnitId: string;
  baseSymbol: string;
  expected: number; // base units announced
  counted: number; // base units already confirmed in earlier counts
  announcedText: string; // e.g. "2 ctn (24 pc)"
  unitId: string;
  good: string;
  damaged: string;
  note: string;
};

type Props = {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  shipmentId: string;
  shipmentNo: string;
  rows: CountRow[];
  /** every active product, for goods that were not announced */
  catalogue: PickerProduct[];
  catalogueMeta: Record<string, { imageV: number | null; baseSymbol: string }>;
  draftNotes: string;
  draftFinish: boolean;
  cancelHref: string;
};

const initial: ActionState = {};
const trim = (n: number) => String(Number(n.toFixed(3)));

function Buttons() {
  const { pending } = useFormStatus();
  return (
    <div className="flex flex-wrap gap-3">
      <button type="submit" name="intent" value="confirm" className="btn-primary min-h-11 px-6 text-base" disabled={pending}>
        {pending ? "Working…" : "Confirm receipt"}
      </button>
      <button type="submit" name="intent" value="save" className="btn-secondary min-h-11" disabled={pending}>
        Save draft
      </button>
    </div>
  );
}

export default function ReceivingForm({ action, shipmentId, shipmentNo, rows: initialRows, catalogue, catalogueMeta, draftNotes, draftFinish, cancelHref }: Props) {
  const [state, formAction] = useActionState(action, initial);
  const fe = state.fieldErrors ?? {};
  const [rows, setRows] = useState(initialRows);
  const [notes, setNotes] = useState(draftNotes);
  const [finish, setFinish] = useState(draftFinish);
  const [intent, setIntent] = useState<"save" | "confirm">("confirm");

  const factorOf = (r: CountRow) => Number(r.units.find((u) => u.id === r.unitId)?.factor ?? 1);
  const num = (s: string) => (s.trim() === "" ? 0 : Number(s));
  const patch = (key: string, p: Partial<CountRow>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const totals = useMemo(() => {
    let good = 0;
    let damaged = 0;
    let missing = 0;
    for (const r of rows) {
      const f = factorOf(r);
      const g = num(r.good) * f;
      const d = num(r.damaged) * f;
      good += Number.isFinite(g) ? g : 0;
      damaged += Number.isFinite(d) ? d : 0;
      if (r.expected > 0) missing += Math.max(r.expected - r.counted - (Number.isFinite(g + d) ? g + d : 0), 0);
    }
    return { good, damaged, missing };
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const payload = JSON.stringify({
    shipmentId,
    intent,
    finish,
    notes: notes.trim() || null,
    lines: rows.map((r) => ({ shipmentItemId: r.shipmentItemId, productId: r.productId, unitId: r.unitId, good: r.good, damaged: r.damaged, note: r.note.trim() || null })),
  });

  const addProduct = (p: PickerProduct) => {
    if (rows.some((r) => r.productId === p.id)) return;
    setRows((all) => [
      ...all,
      { key: `new-${p.id}`, shipmentItemId: null, productId: p.id, name: p.name, sku: p.sku, imageV: catalogueMeta[p.id]?.imageV ?? null, units: p.units.map((u) => ({ id: u.id, name: u.name, symbol: u.symbol, factor: u.factor })), baseUnitId: p.baseUnitId, baseSymbol: catalogueMeta[p.id]?.baseSymbol ?? "", expected: 0, counted: 0, announcedText: "Not announced", unitId: p.baseUnitId, good: "", damaged: "", note: "" },
    ]);
  };

  return (
    <form action={formAction} noValidate onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault(); }} className="space-y-5 pb-28 lg:pb-0">
      <input type="hidden" name="payloadJson" value={payload} />
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && state.message && state.message !== "confirmed" && <Alert kind="success">{state.message}</Alert>}

      <section className="space-y-3">
        {rows.map((r) => {
          const f = factorOf(r);
          const g = num(r.good) * f;
          const d = num(r.damaged) * f;
          const accounted = r.counted + (Number.isFinite(g + d) ? g + d : 0);
          const left = r.expected - accounted;
          const err = fe[`line.${rows.indexOf(r)}`];
          return (
            <div key={r.key} className={cn("card card-pad", err && "border-brand-red")}>
              <div className="flex items-start gap-3">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-gradient-to-b from-white to-slate-100">
                  {r.imageV ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/product-image/${r.productId}?size=thumb&v=${r.imageV}`} alt="" loading="lazy" className="h-full w-full object-contain" />
                  ) : (
                    <ImageOff size={20} className="text-slate-300" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold leading-tight text-slate-900">{r.name}</p>
                  <p className="text-xs text-slate-500">
                    {r.sku} · Announced: <span className="font-medium text-slate-700">{r.announcedText}</span>
                    {r.counted > 0 && ` · already counted ${trim(r.counted)} ${r.baseSymbol}`}
                  </p>
                </div>
                {r.shipmentItemId === null && (
                  <button type="button" className="btn-secondary btn-sm" onClick={() => setRows((all) => all.filter((x) => x.key !== r.key))} aria-label={`Remove ${r.name}`}>
                    <Trash2 size={15} />
                  </button>
                )}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <label className="label" htmlFor={`u-${r.key}`}>
                    Counting in
                  </label>
                  <select id={`u-${r.key}`} className="input" value={r.unitId} onChange={(e) => patch(r.key, { unitId: e.target.value })}>
                    {r.units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                        {u.id !== r.baseUnitId ? ` (${trim(Number(u.factor))} ${r.baseSymbol})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor={`g-${r.key}`}>
                    Good
                  </label>
                  <input id={`g-${r.key}`} className="input text-lg font-semibold" inputMode="decimal" placeholder="0" value={r.good} onChange={(e) => patch(r.key, { good: e.target.value })} />
                </div>
                <div>
                  <label className="label" htmlFor={`d-${r.key}`}>
                    Damaged
                  </label>
                  <input id={`d-${r.key}`} className={cn("input text-lg font-semibold", num(r.damaged) > 0 && "border-brand-red text-brand-red-dark")} inputMode="decimal" placeholder="0" value={r.damaged} onChange={(e) => patch(r.key, { damaged: e.target.value })} />
                </div>
                <div className="flex flex-col justify-end">
                  <p className="label">Still to come</p>
                  <p className={cn("flex min-h-10 items-center rounded-lg px-3 text-sm font-semibold", r.expected === 0 ? "bg-oil-soft text-yellow-800" : left > 0 ? "bg-brand-red-soft text-brand-red-dark" : left < 0 ? "bg-oil-soft text-yellow-800" : "bg-emerald-50 text-emerald-700")}>
                    {r.expected === 0 ? "Extra item" : left > 0 ? `${trim(left)} ${r.baseSymbol} to come` : left < 0 ? `${trim(-left)} ${r.baseSymbol} extra` : "Complete"}
                  </p>
                </div>
              </div>
              <input className="input mt-3" placeholder="Note (optional), e.g. 2 boxes crushed" value={r.note} onChange={(e) => patch(r.key, { note: e.target.value })} aria-label={`Note for ${r.name}`} />
              {err && <p className="field-error">{err}</p>}
            </div>
          );
        })}
      </section>

      <section className="card card-pad">
        <h2 className="mb-2 text-base font-semibold text-slate-900">Something arrived that was not on the list?</h2>
        <ProductPicker products={catalogue.filter((p) => !rows.some((r) => r.productId === p.id))} onPick={addProduct} placeholder="Search a product to add it…" />
        <div className="mt-4">
          <label className="label" htmlFor="rn">
            Notes about this delivery
          </label>
          <textarea id="rn" rows={2} className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. driver arrived 10am, one pallet wet" />
        </div>
        <label className="mt-4 flex items-start gap-2.5 rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
          <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-400" checked={finish} onChange={(e) => setFinish(e.target.checked)} />
          <span>
            <strong>Nothing more is coming.</strong> Anything still missing is recorded as missing and the owner is told.
          </span>
        </label>
      </section>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 px-4 py-3 shadow-[0_-4px_12px_rgba(15,27,45,0.08)] backdrop-blur lg:static lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:left-64">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">
            <span className="font-semibold text-emerald-700">{trim(totals.good)} good</span>
            {totals.damaged > 0 && <span className="font-semibold text-brand-red-dark"> · {trim(totals.damaged)} damaged</span>}
            {totals.missing > 0 && <span className="text-slate-500"> · {trim(totals.missing)} still to come</span>}
          </p>
          <div onClickCapture={(e) => { const t = (e.target as HTMLElement).closest("button[name=intent]") as HTMLButtonElement | null; if (t) setIntent(t.value as "save" | "confirm"); }}>
            <Buttons />
          </div>
        </div>
        <Link href={cancelHref} className="mt-2 inline-block text-sm text-slate-500 hover:text-navy-700 lg:hidden">
          Back to {shipmentNo}
        </Link>
      </div>
    </form>
  );
}
