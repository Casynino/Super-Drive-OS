"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui";
import { SubmitButton } from "@/components/FormBits";
import type { ActionState } from "@/lib/action";

/** "Send now" for the last finished week or month (the scheduled one goes out by itself). */
export default function SendPeriodForm({ action, kind, label, disabled }: { action: (prev: ActionState, fd: FormData) => Promise<ActionState>; kind: "WEEKLY" | "MONTHLY"; label: string; disabled?: boolean }) {
  const [state, formAction] = useActionState(action, {} as ActionState);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="kind" value={kind} />
      <SubmitButton className="btn-secondary btn-sm" pendingLabel="Sending…" disabled={disabled}>
        {label}
      </SubmitButton>
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.message}</Alert>}
    </form>
  );
}
