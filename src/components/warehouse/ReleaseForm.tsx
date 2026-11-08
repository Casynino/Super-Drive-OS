"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { ChevronDown, CircleCheck, Package, ScanLine, X } from "lucide-react";
import Modal from "@/components/Modal";
import { Alert } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import { releaseAction } from "@/app/(app)/warehouse/actions";
import { qtyText } from "@/lib/qty";
import { cn } from "@/lib/utils";

export type ReleaseLine = { id: string; productId: string; name: string; sku: string; waiting: number; waitingText: string; symbol: string; imageV: number | null; /** the carton, to write quantities as cartons + pieces */ pack: { symbol: string; factor: number } | null };
const initial: ActionState = {};

/**
 * The hand-over, made quick (Nino 2026-11-08): who it is for, every product with its picture and how much to hand over, and ONE button.
 * Pressing Release opens a pop-up that lists exactly what will leave the warehouse stock and asks to confirm ("Release only part" lets him enter
 * what was really handed over, the rest stays reserved; the collector's name and a remark are optional). The server rules are unchanged:
 * the goods are taken out of the stock (a SOLD movement), the reservation ends, who and when are recorded.
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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [localError, setLocalError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) document.getElementById("note-banner")?.setAttribute("hidden", "");
  }, [state.ok]);

  if (state.ok) {
    return (
      <section className="card overflow-hidden">
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

  // what will leave the stock: everything still waiting, or the pieces typed for each product
  const going = lines.map((l) => ({ l, n: mode === "all" ? l.waiting : Number((qtys[l.id] ?? "").replace(/,/g, "")) || 0 })).filter((x) => x.n > 0);
  const press = () => {
    if (pending) return;
    if (mode === "some") {
      const over = lines.find((l) => (Number((qtys[l.id] ?? "").replace(/,/g, "")) || 0) > l.waiting);
      if (going.length === 0) return setLocalError("Enter how many pieces were handed over.");
      if (over) return setLocalError(`Only ${over.waitingText} of ${over.name} are waiting.`);
    }
    setLocalError(null);
    setConfirmOpen(true);
  };
  const confirm = () => {
    setConfirmOpen(false);
    formRef.current?.requestSubmit();
  };
  const say = (l: ReleaseLine, n: number) => qtyText(n, l.pack, l.symbol).main;

  return (
    <form ref={formRef} action={action} className="card overflow-hidden" noValidate>
      <input type="hidden" name="noteId" value={noteId} />
      <input type="hidden" name="submissionKey" value={submissionKey} />
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="checked" value="on" />

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Hand over to</p>
          <p className="flex flex-wrap items-center gap-2 text-base font-semibold text-slate-900">
            {customer}
            {winga && <span className="rounded-full bg-oil-400/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-yellow-800 dark:text-oil-400">Winga</span>}
          </p>
        </div>
        <p className="text-right text-xs text-slate-500">
          <span className="font-medium text-slate-700">{paymentLabel}</span> · {saleNo}
        </p>
      </div>

      {(state.error || localError) && (
        <div className="px-4 pt-3 sm:px-5">
          <Alert>{state.error ?? localError}</Alert>
        </div>
      )}

      <ul className="divide-y divide-line">
        {lines.map((l) => (
          <li key={l.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-gradient-to-b from-white to-slate-100">
              {l.imageV ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/product-image/${l.productId}?size=thumb&v=${l.imageV}`} alt="" loading="lazy" className="h-full w-full object-contain" />
              ) : (
                <Package size={18} className="text-slate-300" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-slate-900">{l.name}</span>
              <span className="block font-mono text-[11px] text-slate-500">{l.sku}</span>
            </span>
            {mode === "all" ? (
              <span className="shrink-0 text-right">
                <span className="block text-base font-semibold tabular-nums text-slate-900">{l.waitingText}</span>
                <span className="block text-[11px] tabular-nums text-slate-500">{l.waitingText.endsWith(l.symbol) ? "" : `${l.waiting} ${l.symbol}`}</span>
              </span>
            ) : (
              <span className="flex shrink-0 flex-col items-end gap-0.5">
                <span className="text-[11px] text-slate-500">waiting {l.waitingText}</span>
                <span className="flex items-center gap-1.5">
                  <input name={`qty.${l.id}`} inputMode="numeric" autoComplete="off" placeholder="0" value={qtys[l.id] ?? ""} onChange={(e) => setQtys((q) => ({ ...q, [l.id]: e.target.value.replace(/[^0-9.]/g, "") }))} className="input h-9 w-20 text-right tabular-nums" aria-label={`${l.name}: pieces handed over`} />
                  <span className="w-8 text-xs text-slate-500">{l.symbol}</span>
                </span>
              </span>
            )}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-4 py-3 sm:px-5">
        <button
          type="button"
          onClick={press}
          disabled={pending || lines.length === 0}
          className="inline-flex h-10 items-center justify-center rounded-lg bg-navy-700 px-5 text-sm font-semibold text-[#ffffff] shadow-sm transition hover:bg-navy-800 disabled:opacity-60 max-sm:w-full"
        >
          {pending ? "Releasing…" : mode === "all" ? (lines.length === 1 ? "Release" : `Release all (${lines.length})`) : "Release what I entered"}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode(mode === "all" ? "some" : "all");
            setLocalError(null);
          }}
          className="text-sm font-medium text-navy-700 hover:underline"
        >
          {mode === "all" ? "Release only part" : "Release everything instead"}
        </button>
        <button type="button" onClick={() => setMore(!more)} aria-expanded={more} className="ml-auto inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          Name and remark <ChevronDown size={14} className={cn("transition", more && "rotate-180")} />
        </button>
        {more && (
          <div className="grid w-full gap-3 sm:grid-cols-2">
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
        <p className="w-full text-xs text-slate-500">You will be asked to confirm before anything leaves the stock.</p>
      </div>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} label="Release the goods">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-base font-semibold text-slate-900">Release the goods?</h2>
          <button type="button" onClick={() => setConfirmOpen(false)} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full text-slate-500 hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <p className="text-sm text-slate-600">
            Handing over to <span className="font-semibold text-slate-900">{customer}</span>
            {winga && <span className="ml-1.5 rounded-full bg-oil-400/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-yellow-800 dark:text-oil-400">Winga</span>}
          </p>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {going.map(({ l, n }) => (
              <li key={l.id} className="flex items-center gap-3 px-3 py-2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-white">
                  {l.imageV ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/product-image/${l.productId}?size=thumb&v=${l.imageV}`} alt="" className="h-full w-full object-contain" />
                  ) : (
                    <Package size={16} className="text-slate-300" />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{l.name}</span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{say(l, n)}</span>
              </li>
            ))}
          </ul>
          <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-950">
            These goods <span className="font-semibold">leave the warehouse stock now</span>: the stock goes down by exactly this and the sale is marked collected. It cannot be undone from here.
          </p>
        </div>
        <div className="flex gap-2 border-t border-line px-5 py-3.5">
          <button type="button" onClick={confirm} disabled={pending} className="h-11 flex-1 rounded-xl bg-emerald-600 text-sm font-semibold text-[#ffffff] transition hover:bg-emerald-700 disabled:opacity-60">
            Confirm and release
          </button>
          <button type="button" className="btn-secondary h-11 px-5" onClick={() => setConfirmOpen(false)}>
            Cancel
          </button>
        </div>
      </Modal>
    </form>
  );
}
