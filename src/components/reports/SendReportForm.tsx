"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui";
import { SubmitButton } from "@/components/FormBits";
import type { ActionState } from "@/lib/action";

export default function SendReportForm({ action, today, disabled }: { action: (prev: ActionState, fd: FormData) => Promise<ActionState>; today: string; disabled?: boolean }) {
  const [state, formAction] = useActionState(action, {} as ActionState);
  return (
    <form action={formAction} className="space-y-2.5">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="report-day">
            Day
          </label>
          <input id="report-day" type="date" name="day" defaultValue={today} max={today} className="input w-44" />
        </div>
        <SubmitButton pendingLabel="Sending…" disabled={disabled}>
          Send report
        </SubmitButton>
      </div>
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.message}</Alert>}
    </form>
  );
}
