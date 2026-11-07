"use client";

import { useActionState, useState } from "react";
import { Alert } from "@/components/ui";
import type { ActionState } from "@/lib/action";

/** "Return all goods" with one extra tap to be sure: nothing can be undone afterwards. */
export default function ReturnAllButton({ action, saleId, customerId, submissionKey }: { action: (prev: ActionState, fd: FormData) => Promise<ActionState>; saleId: string; customerId: string; submissionKey: string }) {
  const [state, formAction, pending] = useActionState(action, {} as ActionState);
  const [sure, setSure] = useState(false);
  return (
    <form action={formAction} className="flex flex-col items-stretch gap-2 sm:items-end">
      <input type="hidden" name="saleId" value={saleId} />
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="submissionKey" value={submissionKey} />
      {!sure ? (
        <button type="button" className="btn-primary" onClick={() => setSure(true)}>
          Return all goods
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? "Returning…" : "Yes, take them back"}
          </button>
          <button type="button" className="btn-secondary" onClick={() => setSure(false)} disabled={pending}>
            Cancel
          </button>
        </div>
      )}
      {state.error && <Alert>{state.error}</Alert>}
    </form>
  );
}
