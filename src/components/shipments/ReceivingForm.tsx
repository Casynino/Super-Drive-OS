"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, CheckCheck, ChevronDown, ImageOff, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui";
import ProductPicker from "@/components/inventory/ProductPicker";
import type { ActionState } from "@/lib/action";
import type { PickerProduct } from "@/lib/inventory/types";
import { qtyText } from "@/lib/qty";
import { cn } from "@/lib/utils";

/** One product to count. Quantities are kept in base units (pieces); the screen shows and takes cartons + pieces. */
export type CountRow = {
  key: string;
  shipmentItemId: string | null;
  productId: string;
  name: string;
  sku: string;
  imageV: number | null;
  baseUnitId: string;
  baseSymbol: string;
  /** the carton (the biggest pack); null when the product only has its base unit */
  packUnitId: string | null;
  packSymbol: string | null;
  packFactor: number;
  expected: number; // base units announced
  counted: number; // base units already confirmed in earlier counts
  announcedText: string; // e.g. "32 CTN (128 PCS)"
  /** from a saved draft: good and damaged pieces */
  goodBase: number;
  damagedBase: number;
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

/** What the person types per product: what ARRIVED (cartons + pieces) and, of those, how many are DAMAGED (cartons + pieces). */
type Cell = { aC: string; aP: string; dC: string; dP: string; note: string; open: boolean; picked: boolean; /** the loose-pieces boxes were opened by hand */ pa: boolean; pd: boolean };

const initial: ActionState = {};
const trim = (n: number) => String(Number(n.toFixed(3)));
const num = (s: string) => (s.trim() === "" ? 0 : Number(s));
const clean = (s: string) => s.replace(/[^0-9.]/g, "");
const hasPack = (r: CountRow) => Boolean(r.packUnitId) && r.packFactor > 1;
const baseOf = (r: CountRow, c: string, p: string) => (hasPack(r) ? num(c) * r.packFactor : 0) + num(p);
/** cartons + pieces for a base quantity (whole cartons first, the rest as pieces) */
const split = (r: CountRow, base: number) => {
  if (!hasPack(r) || base <= 0) return { c: "", p: base > 0 ? trim(base) : "" };
  const c = Math.floor(base / r.packFactor + 1e-9);
  const p = Number((base - c * r.packFactor).toFixed(3));
  return { c: c > 0 ? String(c) : "", p: p > 0 ? trim(p) : "" };
};
const packOf = (r: CountRow) => (hasPack(r) ? { symbol: r.packSymbol!, factor: r.packFactor } : null);
const say = (r: CountRow, base: number) => qtyText(base, packOf(r), r.baseSymbol).main;

function toCell(r: CountRow): Cell {
  const a = split(r, r.goodBase + r.damagedBase);
  const d = split(r, r.damagedBase);
  return { aC: a.c, aP: a.p, dC: d.c, dP: d.p, note: r.note, open: r.damagedBase > 0 || r.note !== "", picked: false, pa: false, pd: false };
}

function Buttons({ blocked }: { blocked: boolean }) {
  const { pending } = useFormStatus();
  return (
    <div className="flex gap-2 sm:gap-3">
      <button type="submit" name="intent" value="confirm" className="btn-primary min-h-11 flex-1 px-5 text-base sm:flex-none sm:px-6" disabled={pending || blocked}>
        {pending ? "Working…" : "Confirm and add to stock"}
      </button>
      <button type="submit" name="intent" value="save" className="btn-secondary min-h-11" disabled={pending || blocked}>
        Save draft
      </button>
    </div>
  );
}

export default function ReceivingForm({ action, shipmentId, rows: initialRows, catalogue, catalogueMeta, draftNotes, draftFinish }: Props) {
  const [state, formAction] = useActionState(action, initial);
  const fe = state.fieldErrors ?? {};
  const [rows, setRows] = useState(initialRows);
  const [cells, setCells] = useState<Record<string, Cell>>(() => Object.fromEntries(initialRows.map((r) => [r.key, toCell(r)])));
  const [notes, setNotes] = useState(draftNotes);
  const [finish, setFinish] = useState(draftFinish);
  const [intent, setIntent] = useState<"save" | "confirm">("confirm");

  const cell = (r: CountRow): Cell => cells[r.key] ?? toCell(r);
  const patch = (key: string, p: Partial<Cell>) => setCells((all) => ({ ...all, [key]: { ...(all[key] ?? { aC: "", aP: "", dC: "", dP: "", note: "", open: false, picked: false, pa: false, pd: false }), ...p } }));
  const remaining = (r: CountRow) => Math.max(r.expected - r.counted, 0);
  const counting = rows.filter((r) => r.shipmentItemId !== null && remaining(r) > 0);

  /** "Arrived fine": everything still to come arrived and nothing is damaged. */
  const fine = (r: CountRow): Partial<Cell> => {
    const a = split(r, remaining(r));
    return { aC: a.c, aP: a.p, dC: "", dP: "", open: false };
  };
  const markFine = (list: CountRow[]) =>
    setCells((all) => {
      const next = { ...all };
      for (const r of list) next[r.key] = { ...(next[r.key] ?? toCell(r)), ...fine(r) };
      return next;
    });
  const picked = counting.filter((r) => cell(r).picked);
  const allPicked = counting.length > 0 && picked.length === counting.length;
  const pickAll = (on: boolean) =>
    setCells((all) => {
      const next = { ...all };
      for (const r of counting) next[r.key] = { ...(next[r.key] ?? toCell(r)), picked: on };
      return next;
    });
  const clearPicked = () =>
    setCells((all) => {
      const next = { ...all };
      for (const r of picked) next[r.key] = { ...(next[r.key] ?? toCell(r)), aC: "", aP: "", dC: "", dP: "", picked: false };
      return next;
    });

  /** a number of pieces that makes whole cartons becomes cartons when the person leaves the box */
  const carry = (r: CountRow, which: "a" | "d") => {
    const c = cell(r);
    const total = which === "a" ? baseOf(r, c.aC, c.aP) : baseOf(r, c.dC, c.dP);
    const s = split(r, total);
    patch(r.key, which === "a" ? { aC: s.c, aP: s.p } : { dC: s.c, dP: s.p });
  };

  const calc = (r: CountRow) => {
    const c = cell(r);
    const arrived = baseOf(r, c.aC, c.aP);
    const damaged = baseOf(r, c.dC, c.dP);
    const bad = !Number.isFinite(arrived) || !Number.isFinite(damaged) || damaged > arrived;
    return { arrived: Number.isFinite(arrived) ? arrived : 0, damaged: Number.isFinite(damaged) ? damaged : 0, bad };
  };

  const totals = useMemo(() => {
    let arrived = 0;
    let damaged = 0;
    let missing = 0;
    let bad = false;
    for (const r of rows) {
      const k = calc(r);
      arrived += k.arrived;
      damaged += k.damaged;
      bad = bad || k.bad;
      if (r.expected > 0) missing += Math.max(r.expected - r.counted - k.arrived, 0);
    }
    return { arrived, damaged, missing, bad };
  }, [rows, cells]); // eslint-disable-line react-hooks/exhaustive-deps

  const lines = rows.map((r) => {
    const { arrived, damaged } = calc(r);
    const good = Math.max(arrived - damaged, 0);
    const f = r.packFactor;
    const whole = hasPack(r) && Math.abs(good / f - Math.round(good / f)) < 1e-9 && Math.abs(damaged / f - Math.round(damaged / f)) < 1e-9;
    const unitId = whole ? r.packUnitId! : r.baseUnitId;
    const out = (n: number) => (n <= 0 ? "" : trim(whole ? n / f : n));
    return { shipmentItemId: r.shipmentItemId, productId: r.productId, unitId, good: arrived <= 0 ? "" : out(good), damaged: arrived <= 0 ? "" : out(damaged), note: cell(r).note.trim() || null };
  });
  const payload = JSON.stringify({ shipmentId, intent, finish, notes: notes.trim() || null, lines });

  const addProduct = (p: PickerProduct) => {
    if (rows.some((r) => r.productId === p.id)) return;
    const pack = [...p.units].filter((u) => Number(u.factor) > 1).sort((a, b) => Number(b.factor) - Number(a.factor))[0];
    setRows((all) => [
      ...all,
      { key: `new-${p.id}`, shipmentItemId: null, productId: p.id, name: p.name, sku: p.sku, imageV: catalogueMeta[p.id]?.imageV ?? null, baseUnitId: p.baseUnitId, baseSymbol: catalogueMeta[p.id]?.baseSymbol ?? "", packUnitId: pack?.id ?? null, packSymbol: pack?.symbol ?? null, packFactor: pack ? Number(pack.factor) : 1, expected: 0, counted: 0, announcedText: "Not announced", goodBase: 0, damagedBase: 0, note: "" },
    ]);
  };

  const box = "input h-10 w-16 px-2 text-center text-base font-semibold tabular-nums sm:w-[4.5rem]";

  return (
    <form action={formAction} noValidate onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault(); }} className="space-y-4 pb-28 lg:pb-0">
      <input type="hidden" name="payloadJson" value={payload} />
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && state.message && state.message !== "confirmed" && <Alert kind="success">{state.message}</Alert>}

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-slate-800">
            <input type="checkbox" className="h-5 w-5 rounded border-slate-400" checked={allPicked} onChange={(e) => pickAll(e.target.checked)} disabled={counting.length === 0} aria-label="Select every product" />
            {picked.length > 0 ? `${picked.length} selected` : "Select all"}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {picked.length > 0 && (
              <>
                <button type="button" className="btn-primary btn-sm" onClick={() => markFine(picked)}>
                  <Check size={15} /> Arrived fine ({picked.length})
                </button>
                <button type="button" className="btn-secondary btn-sm" onClick={clearPicked}>
                  Clear
                </button>
              </>
            )}
            <button type="button" className="btn-secondary btn-sm" onClick={() => markFine(counting)} disabled={counting.length === 0}>
              <CheckCheck size={15} /> Everything arrived fine
            </button>
          </div>
        </div>

        <ul className="divide-y divide-line">
          {rows.map((r, idx) => {
            const c = cell(r);
            const k = calc(r);
            const left = r.expected - r.counted - k.arrived;
            const err = fe[`line.${idx}`];
            const announced = r.shipmentItemId !== null;
            const doneBefore = announced && remaining(r) <= 0;
            const status =
              doneBefore ? { text: "Already counted", cls: "bg-emerald-50 text-emerald-700" }
              : !announced ? { text: k.arrived > 0 ? "Extra item" : "Not announced", cls: "bg-oil-soft text-yellow-800" }
              : k.arrived <= 0 ? { text: `${say(r, remaining(r))} to come`, cls: "bg-slate-100 text-slate-600" }
              : left > 0 ? { text: `${say(r, left)} still to come`, cls: "bg-brand-red-soft text-brand-red-dark" }
              : left < 0 ? { text: `${say(r, -left)} extra`, cls: "bg-oil-soft text-yellow-800" }
              : { text: k.damaged > 0 ? "All counted" : "Complete", cls: "bg-emerald-50 text-emerald-700" };
            return (
              <li key={r.key} className={cn("px-4 py-3", (err || k.bad) && "bg-brand-red-soft/40")}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
                  <input type="checkbox" className="h-5 w-5 shrink-0 rounded border-slate-400 disabled:opacity-30" checked={c.picked} onChange={(e) => patch(r.key, { picked: e.target.checked })} disabled={!announced || doneBefore} aria-label={`Select ${r.name}`} />
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-gradient-to-b from-white to-slate-100">
                    {r.imageV ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/product-image/${r.productId}?size=thumb&v=${r.imageV}`} alt="" loading="lazy" className="h-full w-full object-contain" />
                    ) : (
                      <ImageOff size={18} className="text-slate-300" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 basis-40">
                    <span className="block truncate text-[15px] font-semibold leading-tight text-slate-900">{r.name}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {r.sku} · Announced <span className="font-medium text-slate-700">{r.announcedText}</span>
                      {r.counted > 0 && ` · counted before ${say(r, r.counted)}`}
                    </span>
                    <span className={cn("mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold", status.cls)}>{status.text}</span>
                  </span>

                {!doneBefore && (
                  <div className="flex flex-wrap items-end gap-x-4 gap-y-2 max-md:w-full max-md:pl-8">
                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Arrived</p>
                      <div className="flex items-center gap-1.5">
                        {hasPack(r) && (
                          <>
                            <input className={box} inputMode="numeric" placeholder="0" value={c.aC} onChange={(e) => patch(r.key, { aC: clean(e.target.value) })} onBlur={() => carry(r, "a")} aria-label={`${r.name}: cartons that arrived`} />
                            <span className="w-9 text-xs font-medium text-slate-500">{r.packSymbol}</span>
                          </>
                        )}
                        {(!hasPack(r) || c.aP !== "" || c.pa) ? (
                          <>
                            <input className={box} inputMode="numeric" placeholder="0" value={c.aP} onChange={(e) => patch(r.key, { aP: clean(e.target.value) })} onBlur={() => carry(r, "a")} aria-label={`${r.name}: pieces that arrived`} autoFocus={c.pa && c.aP === ""} />
                            <span className="w-9 text-xs font-medium text-slate-500">{r.baseSymbol}</span>
                          </>
                        ) : (
                          <button type="button" className="h-10 rounded-lg px-2 text-sm font-medium text-navy-700 hover:bg-slate-100" onClick={() => patch(r.key, { pa: true })}>
                            + {r.baseSymbol.toLowerCase()}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 pb-0.5">
                      {announced && (
                        <button type="button" className="btn-secondary btn-sm h-10 whitespace-nowrap" onClick={() => patch(r.key, fine(r))}>
                          <Check size={15} /> Arrived fine
                        </button>
                      )}
                      <button type="button" className={cn("inline-flex h-10 items-center gap-1 whitespace-nowrap rounded-lg px-2.5 text-sm font-medium transition", k.damaged > 0 ? "bg-brand-red-soft text-brand-red-dark" : "text-slate-600 hover:bg-slate-100")} onClick={() => patch(r.key, { open: !c.open })} aria-expanded={c.open}>
                        {k.damaged > 0 ? `${say(r, k.damaged)} damaged` : "Damaged or note"}
                        <ChevronDown size={14} className={cn("transition", c.open && "rotate-180")} />
                      </button>
                      {!announced && (
                        <button type="button" className="btn-secondary btn-sm h-10" onClick={() => setRows((all) => all.filter((x) => x.key !== r.key))} aria-label={`Remove ${r.name}`}>
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                )}

                </div>

                {!doneBefore && c.open && (
                  <div className="mt-3 grid gap-3 rounded-xl bg-slate-50 p-3 pl-3 sm:ml-[2.25rem] sm:grid-cols-[auto_1fr] sm:items-end">
                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-brand-red-dark">Of these, damaged</p>
                      <div className="flex items-center gap-1.5">
                        {hasPack(r) && (
                          <>
                            <input className={cn(box, num(c.dC) > 0 && "border-brand-red text-brand-red-dark")} inputMode="numeric" placeholder="0" value={c.dC} onChange={(e) => patch(r.key, { dC: clean(e.target.value) })} onBlur={() => carry(r, "d")} aria-label={`${r.name}: damaged cartons`} />
                            <span className="w-9 text-xs font-medium text-slate-500">{r.packSymbol}</span>
                          </>
                        )}
                        {(!hasPack(r) || c.dP !== "" || c.pd) ? (
                          <>
                            <input className={cn(box, num(c.dP) > 0 && "border-brand-red text-brand-red-dark")} inputMode="numeric" placeholder="0" value={c.dP} onChange={(e) => patch(r.key, { dP: clean(e.target.value) })} onBlur={() => carry(r, "d")} aria-label={`${r.name}: damaged pieces`} autoFocus={c.pd && c.dP === ""} />
                            <span className="w-9 text-xs font-medium text-slate-500">{r.baseSymbol}</span>
                          </>
                        ) : (
                          <button type="button" className="h-10 rounded-lg px-2 text-sm font-medium text-navy-700 hover:bg-white" onClick={() => patch(r.key, { pd: true })}>
                            + {r.baseSymbol.toLowerCase()}
                          </button>
                        )}
                      </div>
                    </div>
                    <input className="input h-10" placeholder="Note (optional), e.g. 2 boxes crushed" value={c.note} onChange={(e) => patch(r.key, { note: e.target.value })} aria-label={`Note for ${r.name}`} />
                  </div>
                )}
                {k.bad && <p className="field-error mt-1 sm:ml-[2.25rem]">Damaged is more than what arrived.</p>}
                {err && <p className="field-error mt-1 sm:ml-[2.25rem]">{err}</p>}
              </li>
            );
          })}
        </ul>
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

      <div className="fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-30 lg:bottom-0 border-t border-line bg-white/95 px-4 py-3 shadow-[0_-4px_12px_rgba(15,27,45,0.08)] backdrop-blur lg:static lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:left-[15.5rem]">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p className="text-sm text-slate-600">
            <span className="font-semibold text-emerald-700">{trim(Math.max(totals.arrived - totals.damaged, 0))} items good</span>
            {totals.damaged > 0 && <span className="font-semibold text-brand-red-dark"> · {trim(totals.damaged)} damaged</span>}
            {totals.missing > 0 && <span className="text-slate-500"> · {trim(totals.missing)} still to come</span>}
            {totals.bad && <span className="font-semibold text-brand-red-dark"> · fix the red lines first</span>}
          </p>
          <div onClickCapture={(e) => { const t = (e.target as HTMLElement).closest("button[name=intent]") as HTMLButtonElement | null; if (t) setIntent(t.value as "save" | "confirm"); }}>
            <Buttons blocked={totals.bad} />
          </div>
        </div>
      </div>
    </form>
  );
}
