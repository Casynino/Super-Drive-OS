"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Alert } from "@/components/ui";
import { Field, SubmitButton, inputClass } from "@/components/FormBits";
import type { ActionState } from "@/lib/action";
import type { EditorLine, LocationOption, PickerProduct } from "@/lib/inventory/types";
import StockLinesEditor from "./StockLinesEditor";

type Variant = "receipt" | "transfer" | "adjustment";

type Props = {
  variant: Variant;
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  products: PickerProduct[];
  locations: LocationOption[];
  stockByLocation: Record<string, Record<string, string>>;
  submissionKey: string;
  cancelHref: string;
  currencySymbol: string;
  // receipt
  suppliers?: { id: string; name: string }[];
  today?: string;
  canCost?: boolean;
  // adjustment
  allowedKinds?: { value: string; label: string }[];
  defaultKind?: string;
};

const initial: ActionState = {};

const QTY_LABEL: Record<string, string> = {
  COUNT: "Counted quantity",
  INCREASE: "Quantity to add",
  DECREASE: "Quantity to remove",
  DAMAGE: "Quantity damaged / missing",
};

export default function StockDocumentForm(p: Props) {
  const [state, action] = useActionState(p.action, initial);
  const fe = state.fieldErrors ?? {};
  const val = (k: string) => state.values?.[k] ?? "";

  const [submissionKey] = useState(p.submissionKey); // stays the same for this page visit, so a double-click can't post twice
  const defaultLoc = p.locations.find((l) => l.isDefault)?.id ?? p.locations[0]?.id ?? "";
  const [locationId, setLocationId] = useState(val("locationId") || val("fromLocationId") || defaultLoc);
  const [toLocationId, setToLocationId] = useState(val("toLocationId"));
  const [type, setType] = useState(val("type") || "PURCHASE");
  const [kind, setKind] = useState(val("kind") || p.defaultKind || p.allowedKinds?.[0]?.value || "");
  const [lines, setLines] = useState<EditorLine[]>(() => {
    try {
      return state.values?.linesJson ? (JSON.parse(state.values.linesJson) as EditorLine[]) : [];
    } catch {
      return [];
    }
  });

  const locOptions = (
    <>
      {p.locations.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name}
          {l.isDefault ? " (default)" : ""}
        </option>
      ))}
    </>
  );

  const showHere = p.variant !== "receipt";
  const quantityLabel = p.variant === "receipt" ? "Quantity received" : p.variant === "transfer" ? "Quantity to transfer" : (QTY_LABEL[kind] ?? "Quantity");
  const submitLabel = p.variant === "receipt" ? "Receive stock" : p.variant === "transfer" ? "Transfer stock" : kind === "COUNT" ? "Submit count" : "Record adjustment";

  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="submissionKey" value={submissionKey} />
      <input type="hidden" name="linesJson" value={JSON.stringify(lines)} />
      {state.error && <Alert>{state.error}</Alert>}

      <section className="card card-pad">
        <h2 className="mb-4 text-base font-semibold text-slate-900">Details</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {p.variant === "receipt" && (
            <>
              <Field label="What are you receiving?" name="type">
                <select id="type" name="type" className="input" value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="PURCHASE">Delivery from a supplier</option>
                  <option value="OPENING_STOCK">Opening stock (stock already on hand)</option>
                </select>
              </Field>
              {type === "PURCHASE" && (
                <Field label="Supplier" name="supplierId" error={fe.supplierId} hint="Optional. Add suppliers under Supplier Accounts.">
                  <select id="supplierId" name="supplierId" className={inputClass(fe.supplierId)} defaultValue={val("supplierId")}>
                    <option value="">No supplier</option>
                    {p.suppliers?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Received into" name="locationId" error={fe.locationId} required>
                <select id="locationId" name="locationId" className={inputClass(fe.locationId)} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  {locOptions}
                </select>
              </Field>
              <Field label="Date received" name="receivedDate" error={fe.receivedDate} required>
                <input id="receivedDate" name="receivedDate" type="date" max={p.today} defaultValue={val("receivedDate") || p.today} className={inputClass(fe.receivedDate)} />
              </Field>
              {type === "PURCHASE" && (
                <Field label="Supplier invoice / delivery note no." name="supplierInvoice" error={fe.supplierInvoice}>
                  <input id="supplierInvoice" name="supplierInvoice" defaultValue={val("supplierInvoice")} className={inputClass(fe.supplierInvoice)} />
                </Field>
              )}
            </>
          )}

          {p.variant === "transfer" && (
            <>
              <Field label="From" name="fromLocationId" error={fe.fromLocationId} required>
                <select id="fromLocationId" name="fromLocationId" className={inputClass(fe.fromLocationId)} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  {locOptions}
                </select>
              </Field>
              <Field label="To" name="toLocationId" error={fe.toLocationId} required>
                <select id="toLocationId" name="toLocationId" className={inputClass(fe.toLocationId)} value={toLocationId} onChange={(e) => setToLocationId(e.target.value)}>
                  <option value="">Choose destination…</option>
                  {p.locations.filter((l) => l.id !== locationId).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}

          {p.variant === "adjustment" && (
            <>
              <Field label="What are you recording?" name="kind" error={fe.kind} required>
                <select id="kind" name="kind" className={inputClass(fe.kind)} value={kind} onChange={(e) => setKind(e.target.value)}>
                  {p.allowedKinds?.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Location" name="locationId" error={fe.locationId} required>
                <select id="locationId" name="locationId" className={inputClass(fe.locationId)} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  {locOptions}
                </select>
              </Field>
              <Field label="Reason" name="reason" error={fe.reason} required className="md:col-span-2" hint="Explain what happened. This is kept permanently in the audit trail.">
                <textarea id="reason" name="reason" rows={2} defaultValue={val("reason")} className={inputClass(fe.reason)} />
              </Field>
            </>
          )}

          {p.variant !== "adjustment" && (
            <Field label="Notes" name="notes" error={fe.notes} className="md:col-span-2">
              <textarea id="notes" name="notes" rows={2} defaultValue={val("notes")} className={inputClass(fe.notes)} />
            </Field>
          )}
        </div>
        {p.variant === "adjustment" && kind === "COUNT" && (
          <p className="mt-3 rounded-lg bg-navy-50 px-3 py-2 text-sm text-navy-800">
            Enter what you physically counted. Only the difference from the system quantity is posted. Enter 0 if the shelf is empty.
          </p>
        )}
      </section>

      <section className="card card-pad">
        <h2 className="mb-3 text-base font-semibold text-slate-900">Products</h2>
        <StockLinesEditor
          products={p.products}
          lines={lines}
          onChange={setLines}
          showCost={p.variant === "receipt" && p.canCost}
          quantityLabel={quantityLabel}
          onHand={showHere ? p.stockByLocation[locationId] ?? {} : undefined}
          errors={fe}
          currencySymbol={p.currencySymbol}
        />
        {p.variant === "receipt" && !p.canCost && (
          <p className="hint mt-3">Stock is received at each product’s current purchase price. Only users who manage costs can enter different costs.</p>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Posting…">{submitLabel}</SubmitButton>
        <Link href={p.cancelHref} className="btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
