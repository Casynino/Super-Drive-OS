"use client";

import { useActionState, useId } from "react";
import { Alert } from "@/components/ui";
import AccountSelect, { type FormAccount } from "@/components/cash/AccountSelect";
import { Field, SubmitButton, inputClass } from "@/components/FormBits";
import type { ActionState } from "@/lib/action";

export default function SupplierPayForm({ action, supplierId, submissionKey, shipments, accounts }: { action: (prev: ActionState, fd: FormData) => Promise<ActionState>; supplierId: string; submissionKey: string; shipments: { id: string; label: string }[]; accounts: FormAccount[] }) {
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
        <Field label="Paid from" name="accountId" id={id("account")} error={fe.accountId ?? fe.method}>
          <AccountSelect accounts={accounts} id={id("account")} defaultValue={v.accountId ?? accounts.find((a) => a.method === "BANK")?.id} error={fe.accountId ?? fe.method} />
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
