"use client";

import { useActionState, useId } from "react";
import { Alert } from "@/components/ui";
import { Field, SubmitButton, inputClass } from "@/components/FormBits";
import type { ActionState } from "@/lib/action";

export default function SupplierPayForm({ action, supplierId, submissionKey, shipments }: { action: (prev: ActionState, fd: FormData) => Promise<ActionState>; supplierId: string; submissionKey: string; shipments: { id: string; label: string }[] }) {
  const [state, formAction] = useActionState(action, {} as ActionState);
  const uid = useId();
  const id = (n: string) => `${uid}-${n}`;
  const fe = state.fieldErrors ?? {};
  const v = state.values ?? {};
  return (
    <form action={formAction} noValidate className="space-y-4">
      <input type="hidden" name="supplierId" value={supplierId} />
      <input type="hidden" name="submissionKey" value={submissionKey} />
      {state.error && <Alert>{state.error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount paid" name="amount" id={id("amount")} error={fe.amount} required>
          <input id={id("amount")} name="amount" inputMode="numeric" autoComplete="off" defaultValue={v.amount ?? ""} placeholder="0" className={`${inputClass(fe.amount)} font-semibold`} />
        </Field>
        <Field label="Paid from" name="method" id={id("method")} error={fe.method}>
          <select id={id("method")} name="method" defaultValue={v.method ?? "BANK"} className={inputClass(fe.method)}>
            <option value="BANK">Bank account</option>
            <option value="MOBILE_MONEY">Mobile money</option>
            <option value="CASH">Cash on hand</option>
          </select>
        </Field>
        <Field label="Reference" name="reference" id={id("ref")} error={fe.reference} hint="Bank or mobile money reference (not needed for cash).">
          <input id={id("ref")} name="reference" autoComplete="off" defaultValue={v.reference ?? ""} className={inputClass(fe.reference)} />
        </Field>
        <Field label="For which shipment (optional)" name="shipmentId" id={id("ship")} error={fe.shipmentId}>
          <select id={id("ship")} name="shipmentId" defaultValue={v.shipmentId ?? ""} className={inputClass(fe.shipmentId)}>
            <option value="">General payment</option>
            {shipments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Notes (optional)" name="notes" id={id("notes")} className="sm:col-span-2">
          <input id={id("notes")} name="notes" autoComplete="off" defaultValue={v.notes ?? ""} className="input" />
        </Field>
      </div>
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Saving…">Record payment</SubmitButton>
      </div>
    </form>
  );
}
