"use client";

import Link from "next/link";
import { useActionState, useId, useState } from "react";
import { Alert } from "@/components/ui";
import { Field, SubmitButton, inputClass } from "@/components/FormBits";
import StockLinesEditor from "@/components/inventory/StockLinesEditor";
import type { ActionState } from "@/lib/action";
import type { EditorLine, LocationOption, PickerProduct } from "@/lib/inventory/types";

type Props = {
  variant: "issue" | "sold" | "return";
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  resellerId: string;
  products: PickerProduct[];
  /** issue: shelf stock per location; sold/return: what the reseller holds (key "reseller") */
  stockByLocation: Record<string, Record<string, string>>;
  /** agreed or list price per BASE unit, as a plain number string */
  prices: Record<string, string>;
  locations: LocationOption[];
  submissionKey: string;
  symbol: string;
  canPrice?: boolean;
  cancelHref: string;
};

const initial: ActionState = {};
const money = (n: number, symbol: string) => `${symbol} ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n)}`;

function prefixed(errors: Record<string, string>, prefix: string) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(errors)) if (k.startsWith(`${prefix}.`)) out[`line.${k.slice(prefix.length + 1)}`] = v;
  return out;
}

export default function ResellerStockForm(p: Props) {
  const [state, formAction] = useActionState(p.action, initial);
  const uid = useId();
  const fe = state.fieldErrors ?? {};
  const v = state.values ?? {};
  const [submissionKey] = useState(p.submissionKey);
  const parse = (s?: string): EditorLine[] => {
    try {
      return s ? (JSON.parse(s) as EditorLine[]) : [];
    } catch {
      return [];
    }
  };
  const [lines, setLines] = useState<EditorLine[]>(() => parse(v.linesJson));
  const [good, setGood] = useState<EditorLine[]>(() => parse(v.goodJson));
  const [bad, setBad] = useState<EditorLine[]>(() => parse(v.damagedJson));
  const defaultLoc = p.locations.find((l) => l.isDefault)?.id ?? p.locations[0]?.id ?? "";
  const [locationId, setLocationId] = useState(v.fromLocationId || v.toLocationId || defaultLoc);

  const byId = new Map(p.products.map((x) => [x.id, x]));
  const lineValue = (l: EditorLine) => {
    const prod = byId.get(l.productId);
    const unit = prod?.units.find((u) => u.id === l.unitId);
    const qty = Number(l.quantity);
    const base = Number(p.prices[l.productId] ?? 0);
    if (!prod || !unit || !Number.isFinite(qty)) return 0;
    const own = p.variant === "sold" && p.canPrice && l.totalCost.trim() !== "" ? Number(l.totalCost) : null;
    return qty * (own !== null && Number.isFinite(own) ? own : base * Number(unit.factor));
  };
  const estimate = lines.reduce((s, l) => s + lineValue(l), 0);
  const hasPriceOverride = p.variant === "sold" && p.canPrice && lines.some((l) => l.totalCost.trim() !== "");
  const heldHere = p.variant === "issue" ? (p.stockByLocation[locationId] ?? {}) : (p.stockByLocation.reseller ?? {});
  // sold / return can only use what the reseller holds
  const pickable = p.variant === "issue" ? p.products : p.products.filter((x) => Number(heldHere[x.id] ?? 0) > 0);

  const title = { issue: "Issue stock", sold: "Record what was sold", return: "Record a return" }[p.variant];
  return (
    <form action={formAction} noValidate className="space-y-5">
      <input type="hidden" name="submissionKey" value={submissionKey} />
      <input type="hidden" name="resellerId" value={p.resellerId} />
      {p.variant === "return" ? (
        <>
          <input type="hidden" name="goodJson" value={JSON.stringify(good)} />
          <input type="hidden" name="damagedJson" value={JSON.stringify(bad)} />
        </>
      ) : (
        <input type="hidden" name="linesJson" value={JSON.stringify(lines)} />
      )}
      {state.error && <Alert>{state.error}</Alert>}

      {p.variant === "return" ? (
        <>
          <section className="card card-pad">
            <h2 className="text-base font-semibold text-slate-900">Goods that can be sold again</h2>
            <p className="mb-3 text-sm text-slate-500">They go back on the shop shelf.</p>
            <StockLinesEditor products={pickable} lines={good} onChange={setGood} quantityLabel="Quantity returned" onHand={heldHere} errors={prefixed(fe, "good")} />
          </section>
          <section className="card card-pad">
            <h2 className="text-base font-semibold text-slate-900">Damaged goods</h2>
            <p className="mb-3 text-sm text-slate-500">They are written off. They do not go back on the shelf.</p>
            <StockLinesEditor products={pickable} lines={bad} onChange={setBad} quantityLabel="Quantity damaged" onHand={heldHere} errors={prefixed(fe, "damaged")} />
          </section>
        </>
      ) : (
        <section className="card card-pad">
          <h2 className="mb-1 text-base font-semibold text-slate-900">{p.variant === "issue" ? "Products to give" : "Products sold"}</h2>
          <p className="mb-3 text-sm text-slate-500">
            {p.variant === "issue" ? "Search for each product and enter how many the winga is taking." : "Enter how many of each product the winga says they sold. The agreed prices are used."}
          </p>
          <StockLinesEditor
            products={pickable}
            lines={lines}
            onChange={setLines}
            quantityLabel={p.variant === "issue" ? "Quantity issued" : "Quantity sold"}
            onHand={heldHere}
            errors={fe}
            showCost={p.variant === "sold" && p.canPrice}
            costLabel="Different price per unit (optional)"
          />
          {lines.length > 0 && (
            <p className="mt-4 flex items-baseline justify-between rounded-lg bg-navy-50 px-3.5 py-2.5 text-sm text-navy-800">
              <span>{p.variant === "issue" ? "Value of the stock at the agreed prices (about)" : "The winga will owe (about)"}</span>
              <strong className="text-lg tabular-nums">{money(estimate, p.symbol)}</strong>
            </p>
          )}
        </section>
      )}

      <section className="card card-pad">
        <div className="grid gap-4 md:grid-cols-2">
          {p.variant !== "sold" && (
            <Field label={p.variant === "issue" ? "Take the stock from" : "Put good goods back into"} name={p.variant === "issue" ? "fromLocationId" : "toLocationId"} id={`${uid}-loc`} error={fe.fromLocationId ?? fe.toLocationId} required>
              <select id={`${uid}-loc`} name={p.variant === "issue" ? "fromLocationId" : "toLocationId"} value={locationId} onChange={(e) => setLocationId(e.target.value)} className={inputClass(fe.fromLocationId ?? fe.toLocationId)}>
                {p.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {hasPriceOverride && (
            <Field label="Why is the price different?" name="discountReason" id={`${uid}-reason`} error={fe.discountReason} required>
              <input id={`${uid}-reason`} name="discountReason" autoComplete="off" defaultValue={v.discountReason ?? ""} className={inputClass(fe.discountReason)} placeholder="e.g. the owner agreed a lower price" />
            </Field>
          )}
          <Field label="Notes (optional)" name="notes" id={`${uid}-notes`} className={p.variant === "sold" && !hasPriceOverride ? "md:col-span-2" : undefined}>
            <input id={`${uid}-notes`} name="notes" autoComplete="off" defaultValue={v.notes ?? ""} className="input" />
          </Field>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <Link href={p.cancelHref} className="btn-secondary">
          Cancel
        </Link>
        <SubmitButton pendingLabel="Saving…">{title}</SubmitButton>
      </div>
    </form>
  );
}
