"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui";
import CodeScanner from "@/components/scan/CodeScanner";
import { scanAction } from "@/app/(app)/warehouse/actions";

/** Scan the QR code on a pickup note (camera or a USB scanner typing into the box), or type the note number. The server does the checking. */
export default function WarehouseScanner() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  const look = (code: string) =>
    start(async () => {
      const r = await scanAction(code);
      if (r.ok) router.push(`/warehouse/orders/${r.noteId}?scanned=1`);
      else setError(r.message);
    });

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,460px)_1fr]">
      <div className="card card-pad">
        <CodeScanner onScan={(c) => look(c)} busy={pending} autoStart />
      </div>
      <div className="space-y-4">
        <form
          className="card card-pad"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.trim()) look(typed);
          }}
        >
          <h2 className="text-base font-semibold text-slate-900">Or type the note number</h2>
          <p className="text-sm text-slate-500">For example PU-2026-000125. A USB scanner can also type straight into this box.</p>
          <div className="mt-3 flex gap-2">
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="PU-2026-000125" autoComplete="off" className="input h-11 flex-1 font-mono" aria-label="Pickup note number or code" />
            <button className="btn-primary h-11" type="submit" disabled={pending || !typed.trim()}>
              Open
            </button>
          </div>
        </form>
        {error && <Alert>{error}</Alert>}
        <div className="card card-pad text-sm text-slate-600">
          <p className="font-medium text-slate-900">What happens after the scan</p>
          <p className="mt-1">The note opens with the customer, the payment status and exactly which products and quantities to hand over. A note that was already collected, was cancelled, or is not authorised is refused and says why.</p>
        </div>
      </div>
    </div>
  );
}
