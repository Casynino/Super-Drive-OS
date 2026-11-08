"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui";
import { markReadyAction, startPreparingAction } from "@/app/(app)/warehouse/actions";

/** Start picking, and mark the goods ready for collection. */
export default function OrderActions({ noteId, status }: { noteId: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: (id: string) => Promise<{ ok?: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn(noteId);
      if (r.error) setError(r.error);
      else {
        setError(null);
        router.refresh();
      }
    });
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "NEW" && (
        <button type="button" className="btn-secondary btn-sm" disabled={pending} onClick={() => run(startPreparingAction)}>
          Start preparing
        </button>
      )}
      {(status === "NEW" || status === "PREPARING") && (
        <button type="button" className="btn-primary btn-sm" disabled={pending} onClick={() => run(markReadyAction)}>
          Mark ready for collection
        </button>
      )}
      {error && <Alert>{error}</Alert>}
    </div>
  );
}
