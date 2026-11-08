"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { ChevronDown, CircleCheck, Package, ScanLine } from "lucide-react";
import { Alert } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import { releaseAction } from "@/app/(app)/warehouse/actions";
import { cn } from "@/lib/utils";

export type ReleaseLine = { id: string; productId: string; name: string; sku: string; waiting: number; waitingText: string; symbol: string; imageV: number | null };
const initial: ActionState = {};

/**
 * The hand-over, made quick (Nino 2026-11-08): who it is for, every product with its picture and how much to hand over, and ONE big
 * button. Everything still waiting is released with two taps (the second tap confirms), "Release only part" lets him enter what was
 * really handed over (the rest stays reserved), and the collector's name and a remark are optional. The server rules are unchanged:
 * stock leaves, the reservation ends, who and when are recorded.
 */
export default function ReleaseForm({
  noteId,
  submissionKey,
  lines,
  customer,
  winga,
  saleNo,
  paymentLabel,
}: {
  noteId: string;
  noteNo: string;
  submissionKey: string;
  lines: ReleaseLine[];
  customer: string;
  winga: boolean;
  saleNo: string;
  paymentLabel: string;
}) {
  const [state, action, pending] = useActionState(releaseAction, initial);
  const [mode, setMode] = useState<"all" | "some">("all");
  const [armed, setArmed] = useState(false);
  const [more, setMore] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // the first tap arms the button, the second one confirms; it disarms by itself after a few seconds
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  useEffect(() => {
    if (state.ok) document.getElementById("note-banner")?.setAttribute("hidden", "");
  }, [state.ok]);

  if (state.ok) {
    return (
      <section className="card mb-5 overflow-hidden">
        <div className="flex flex-col items-center gap-3 px-6 py-9 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-emerald-500 text-[#ffffff]">
            <CircleCheck size={30} />
          </span>
          <p className="text-lg font-semibold text-slate-900">{state.message}</p>
          <p className="text-sm text-slate-500">The goods have left the warehouse stock.</p>
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            <Link href="/warehouse/scan" className="btn-primary h-11 px-5">
              <ScanLine size={17} /> Scan next
            </Link>
            <Link href="/warehouse/orders" className="btn-secondary h-11 px-5">
              All collections
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (lines.length === 0) return null;

  const press = () => {
    if (pending) return;
    if (!armed) return setArmed(true);
    setArmed(false);
    formRef.current?.requestSubmit();
  };

  return (
    <form ref={formRef} action={action} className="card mb-5 overflow-hidden" noValidate>
      <input type="hidden" name="noteId" value={noteId} />
      <input type="hidden" name="submissionKey" value={submissionKey} />
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="checked" value="on" />

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Hand over to</p>
          <p className="flex flex-wrap items-center gap-2 text-lg font-semibold text-slate-900">
            {customer}
            {winga && <span className="rounded-full bg-oil-400/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-yellow-800 dark:text-oil-400">Winga</span>}
          </p>
        </div>
        <p className="text-right text-xs text-slate-500">
          <span className="block font-medium text-slate-700">{paymentLabel}</span>
          Sale {saleNo}
        </p>
      </div>

      {state.error && (
        <div className="px-4 pt-3 sm:px-5">
          <Alert>{state.error}</Alert>
        </div>
      )}

      <ul className="divide-y divide-line">
        {lines.map((l) => (
          <li key={l.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-gradient-to-b from-white to-slate-100">
              {l.imageV ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/product-image/${l.productId}?size=thumb&v=${l.imageV}`} alt="" loading="lazy" className="h-full w-full object-contain" />
              ) : (
                <Package size={22} className="text-slate-300" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold text-slate-900">{l.name}</span>
              <span className="block font-mono text-[11px] text-slate-500">{l.sku}</span>
            </span>
            {mode === "all" ? (
              <span className="shrink-0 text-right">
                <span className="block text-xl font-bold tabular-nums text-slate-900">{l.waitingText}</span>
                <span className="block text-[11px] tabular-nums text-slate-500">{l.waitingText.endsWith(l.symbol) ? "" : `${l.waiting} ${l.symbol}`}</span>
              </span>
            ) : (
              <span className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-[11px] text-slate-500">waiting {l.waitingText}</span>
                <span className="flex items-center gap-1.5">
                  <input name={`qty.${l.id}`} inputMode="numeric" autoComplete="off" placeholder="0" className="input h-10 w-24 text-right tabular-nums" aria-label={`${l.name}: pieces handed over`} />
                  <span className="w-8 text-xs text-slate-500">{l.symbol}</span>
                </span>
              </span>
            )}
          </li>
        ))}
      </ul>

      <div className="space-y-3 border-t border-line px-4 py-4 sm:px-5">
        <button
          type="button"
          onClick={press}
          disabled={pending || lines.length === 0}
          className={cn("flex h-14 w-full items-center justify-center rounded-xl text-base font-semibold text-[#ffffff] shadow-sm transition disabled:opacity-60", armed ? "bg-emerald-600 hover:bg-emerald-700" : "bg-navy-700 hover:bg-navy-800")}
        >
          {pending ? "Releasing…" : armed ? "Tap again to confirm" : mode === "all" ? `Release all · ${lines.length} product${lines.length === 1 ? "" : "s"}` : "Release what I entered"}
        </button>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <button
            type="button"
            onClick={() => {
              setMode(mode === "all" ? "some" : "all");
              setArmed(false);
            }}
            className="font-medium text-navy-700 hover:underline"
          >
            {mode === "all" ? "Release only part" : "Release everything instead"}
          </button>
          <button type="button" onClick={() => setMore(!more)} aria-expanded={more} className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800">
            Name and remark <ChevronDown size={14} className={cn("transition", more && "rotate-180")} />
          </button>
        </div>
        {more && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-slate-700">
              Collected by
              <input name="collectedBy" autoComplete="off" maxLength={80} className="input mt-1 h-10" placeholder="Name of the person" />
            </label>
            <label className="text-sm text-slate-700">
              Remark
              <input name="remark" autoComplete="off" maxLength={300} className="input mt-1 h-10" />
            </label>
          </div>
        )}
        <p className="text-xs text-slate-500">This takes the goods out of the warehouse stock and cannot be undone.</p>
      </div>
    </form>
  );
}
