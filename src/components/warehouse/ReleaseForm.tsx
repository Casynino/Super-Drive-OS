"use client";

import { useActionState, useState } from "react";
import { Alert } from "@/components/ui";
import { SubmitButton } from "@/components/FormBits";
import type { ActionState } from "@/lib/action";
import { releaseAction } from "@/app/(app)/warehouse/actions";
import { cn } from "@/lib/utils";

export type ReleaseLine = { id: string; name: string; sku: string; waiting: number; waitingText: string; symbol: string };
const initial: ActionState = {};

/**
 * The hand-over: the attendant compares the goods with the list, ticks that he did, and confirms. Everything still waiting is
 * released by default; "Release only part" lets him enter what was really handed over (the rest stays reserved).
 */
export default function ReleaseForm({ noteId, noteNo, submissionKey, lines }: { noteId: string; noteNo: string; submissionKey: string; lines: ReleaseLine[] }) {
  const [state, action] = useActionState(releaseAction, initial);
  const [mode, setMode] = useState<"all" | "some">("all");
  const [checked, setChecked] = useState(false);

  if (state.ok) {
    return (
      <div className="card card-pad">
        <Alert kind="success">{state.message}</Alert>
      </div>
    );
  }

  return (
    <form action={action} className="card card-pad space-y-4" noValidate>
      <input type="hidden" name="noteId" value={noteId} />
      <input type="hidden" name="submissionKey" value={submissionKey} />
      <input type="hidden" name="mode" value={mode} />
      <div>
        <h2 className="text-base font-semibold text-slate-900">Hand over the goods</h2>
        <p className="text-sm text-slate-500">Compare what is on the shelf with the list above, then confirm.</p>
      </div>
      {state.error && <Alert>{state.error}</Alert>}

      <div className="inline-flex rounded-lg border border-line bg-slate-50 p-1 text-sm font-medium" role="group" aria-label="How much is handed over">
        {([["all", "Release everything"], ["some", "Release only part"]] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setMode(k)} aria-pressed={mode === k} className={cn("rounded-md px-3.5 py-1.5 transition", mode === k ? "bg-navy-700 text-white shadow-sm" : "text-slate-600 hover:text-slate-900")}>
            {label}
          </button>
        ))}
      </div>

      {mode === "some" && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">Enter the pieces handed over now. Whatever you leave empty stays reserved for the next collection.</p>
          {lines.map((l) => (
            <label key={l.id} className="grid items-center gap-3 sm:grid-cols-[1fr_9rem]">
              <span className="min-w-0 text-sm">
                <span className="font-medium text-slate-900">{l.name}</span>
                <span className="ml-2 text-xs text-slate-500">waiting {l.waitingText}{l.waitingText.endsWith(l.symbol) ? "" : ` (${l.waiting} ${l.symbol})`}</span>
              </span>
              <span className="flex items-center gap-2">
                <input name={`qty.${l.id}`} inputMode="numeric" autoComplete="off" placeholder="0" className="input h-10 text-right tabular-nums" aria-label={`${l.name}: pieces handed over`} />
                <span className="w-9 text-xs text-slate-500">{l.symbol}</span>
              </span>
            </label>
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-slate-700">
          Collected by <span className="text-xs text-slate-400">(optional)</span>
          <input name="collectedBy" autoComplete="off" maxLength={80} className="input mt-1 h-10" placeholder="Name of the person" />
        </label>
        <label className="text-sm text-slate-700">
          Remark <span className="text-xs text-slate-400">(optional)</span>
          <input name="remark" autoComplete="off" maxLength={300} className="input mt-1 h-10" />
        </label>
      </div>

      <label className="flex cursor-pointer items-start gap-2.5 text-sm text-slate-700">
        <input type="checkbox" name="checked" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300" />
        <span>I checked the goods against {noteNo} and handed them over.</span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Releasing…" disabled={!checked}>
          Confirm goods released
        </SubmitButton>
        <span className="text-xs text-slate-500">This takes the goods out of the warehouse stock and cannot be undone.</span>
      </div>
    </form>
  );
}
