"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/components/ui";
import type { ActionState } from "@/lib/action";

const initial: ActionState = {};

function Buttons() {
  const { pending } = useFormStatus();
  return (
    <div className="flex flex-wrap gap-2">
      <button type="submit" name="decision" value="approve" className="btn-primary" disabled={pending}>
        {pending ? "Working…" : "Approve"}
      </button>
      <button type="submit" name="decision" value="reject" className="btn-danger" disabled={pending}>
        Reject
      </button>
    </div>
  );
}

export default function DecisionForm({ reversalId, action }: { reversalId: string; action: (prev: ActionState, fd: FormData) => Promise<ActionState> }) {
  const [state, formAction] = useActionState(action, initial);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="space-y-2.5">
      <input type="hidden" name="reversalId" value={reversalId} />
      <input name="note" className={`input ${fe.note ? "input-error" : ""}`} placeholder="Note (required to reject)" aria-label="Decision note" />
      {fe.note && <p className="field-error">{fe.note}</p>}
      {state.error && !state.fieldErrors?.note && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.message}</Alert>}
      <Buttons />
    </form>
  );
}
