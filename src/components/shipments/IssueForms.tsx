"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui";
import { SubmitButton } from "@/components/FormBits";
import type { ActionState } from "@/lib/action";

const initial: ActionState = {};

export function ResolveIssueForm({ shipmentId, action }: { shipmentId: string; action: (prev: ActionState, fd: FormData) => Promise<ActionState> }) {
  const [state, formAction] = useActionState(action, initial);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="space-y-2.5">
      <input type="hidden" name="shipmentId" value={shipmentId} />
      <label className="label" htmlFor="resolve-note">
        What did you find or decide?
      </label>
      <textarea id="resolve-note" name="note" rows={2} className={`input ${fe.note ? "input-error" : ""}`} placeholder="e.g. Supplier will refund the 4 damaged bottles; counted again and confirmed" />
      {fe.note && <p className="field-error">{fe.note}</p>}
      {state.error && !fe.note && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.message}</Alert>}
      <SubmitButton pendingLabel="Saving…">Close investigation</SubmitButton>
    </form>
  );
}

export function CancelShipmentForm({ shipmentId, action }: { shipmentId: string; action: (prev: ActionState, fd: FormData) => Promise<ActionState> }) {
  const [state, formAction] = useActionState(action, initial);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="flex flex-wrap items-start gap-2">
      <input type="hidden" name="shipmentId" value={shipmentId} />
      <div className="min-w-60 flex-1">
        <input name="reason" className={`input ${fe.reason ? "input-error" : ""}`} placeholder="Why is it cancelled?" aria-label="Reason for cancelling" />
        {fe.reason && <p className="field-error">{fe.reason}</p>}
        {state.error && !fe.reason && <p className="field-error">{state.error}</p>}
      </div>
      <SubmitButton className="btn-danger" pendingLabel="Cancelling…">
        Cancel shipment
      </SubmitButton>
    </form>
  );
}
