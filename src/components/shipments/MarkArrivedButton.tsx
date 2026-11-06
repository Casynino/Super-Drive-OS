"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Truck } from "lucide-react";
import type { ActionState } from "@/lib/action";
import { cn } from "@/lib/utils";

function Submit({ small }: { small: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={cn("btn-primary", small && "btn-sm")} disabled={pending} aria-busy={pending}>
      {pending ? <Loader2 size={small ? 14 : 16} className="animate-spin" /> : <Truck size={small ? 14 : 16} />}
      {pending ? "Saving…" : "Mark as arrived"}
    </button>
  );
}

/** The shop presses this when the delivery is at the door. Counting opens up afterwards. */
export default function MarkArrivedButton({ shipmentId, action, small = false }: { shipmentId: string; action: (prev: ActionState, fd: FormData) => Promise<ActionState>; small?: boolean }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="shipmentId" value={shipmentId} />
      <Submit small={small} />
      {state.error && (
        <span role="alert" className="max-w-56 text-right text-xs text-brand-red-dark">
          {state.error}
        </span>
      )}
    </form>
  );
}
