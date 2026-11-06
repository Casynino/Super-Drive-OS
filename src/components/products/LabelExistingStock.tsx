"use client";

import { useActionState } from "react";
import { Loader2, QrCode } from "lucide-react";
import type { ActionState } from "@/lib/action";

/** One button for the owner: give the stock already on the shelf its own item numbers. */
export default function LabelExistingStock({ missing, action }: { missing: number; action: (prev: ActionState, fd: FormData) => Promise<ActionState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <div className="card card-pad mb-4 flex flex-wrap items-center justify-between gap-3 border-oil-400/60 bg-oil-soft/40">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900">{missing} piece{missing === 1 ? "" : "s"} of stock have no item number yet</p>
        <p className="text-sm text-slate-600">They were received before item tracking. One press gives each piece its own number and QR code, then you can print the labels.</p>
        {state.error && <p className="field-error">{state.error}</p>}
        {state.ok && state.message && <p className="mt-1 text-sm font-medium text-emerald-700">{state.message}</p>}
      </div>
      <form action={formAction}>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? <Loader2 size={16} className="animate-spin" /> : <QrCode size={16} />}
          {pending ? "Working…" : "Give them item numbers"}
        </button>
      </form>
    </div>
  );
}
