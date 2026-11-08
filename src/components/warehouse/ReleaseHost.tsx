"use client";

import Link from "next/link";
import { createContext, useContext, useState } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, CircleCheck, Package, ScanLine, X } from "lucide-react";
import Modal from "@/components/Modal";
import { Alert } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import { releaseAction } from "@/app/(app)/warehouse/actions";
import { qtyText } from "@/lib/qty";
import { cn } from "@/lib/utils";
import type { ReleaseLine } from "./ReleaseForm";

/** What the Pickups list knows about one waiting note, enough to release all of it from a pop-up without opening the note. */
export type ListNote = { id: string; noteNo: string; customer: string; winga: boolean; saleNo: string; paymentLabel: string; lines: ReleaseLine[] };

const Ctx = createContext<(n: ListNote) => void>(() => {});
const initial: ActionState = {};

function Dialog({ note, onClose, onNext }: { note: ListNote; onClose: () => void; /** on the scanner page: close and keep scanning (instead of linking to it) */ onNext?: () => void }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(releaseAction, initial);
  const [key] = useState(() => crypto.randomUUID());
  const [more, setMore] = useState(false);
  const say = (l: ReleaseLine) => qtyText(l.waiting, l.pack, l.symbol).main;

  if (state.ok) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-emerald-500 text-[#ffffff]">
          <CircleCheck size={30} />
        </span>
        <p className="text-lg font-semibold text-slate-900">{state.message}</p>
        <p className="text-sm text-slate-500">The goods have left the warehouse stock.</p>
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          {onNext ? (
            <button type="button" className="btn-primary h-11 px-5" onClick={onNext}>
              <ScanLine size={17} /> Scan next
            </button>
          ) : (
            <Link href="/warehouse/scan" className="btn-primary h-11 px-5">
              <ScanLine size={17} /> Scan next
            </Link>
          )}
          <button
            type="button"
            className="btn-secondary h-11 px-5"
            onClick={() => {
              router.refresh();
              onClose();
            }}
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col" noValidate>
      <input type="hidden" name="noteId" value={note.id} />
      <input type="hidden" name="submissionKey" value={key} />
      <input type="hidden" name="mode" value="all" />
      <input type="hidden" name="checked" value="on" />
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Release the goods?</h2>
          <p className="font-mono text-xs text-slate-500">{note.noteNo}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full text-slate-500 hover:bg-slate-100">
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
        <p className="text-sm text-slate-600">
          Handing over to <span className="font-semibold text-slate-900">{note.customer}</span>
          {note.winga && <span className="ml-1.5 rounded-full bg-oil-400/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-yellow-800 dark:text-oil-400">Winga</span>}
          <span className="text-slate-500"> · {note.paymentLabel.split(",")[0]} · {note.saleNo}</span>
        </p>
        <ul className="divide-y divide-line rounded-xl border border-line">
          {note.lines.map((l) => (
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
              <span className="shrink-0 text-sm font-bold tabular-nums text-slate-900">{say(l)}</span>
            </li>
          ))}
        </ul>
        <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-950">
          These goods <span className="font-semibold">leave the warehouse stock now</span>: the stock goes down by exactly this and the sale is marked collected. It cannot be undone from here.
        </p>
        <button type="button" onClick={() => setMore(!more)} aria-expanded={more} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          Name and remark (optional) <ChevronDown size={14} className={cn("transition", more && "rotate-180")} />
        </button>
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
        {state.error && <Alert>{state.error}</Alert>}
        <p className="text-xs text-slate-500">
          Only part of it was handed over?{" "}
          <Link href={`/warehouse/orders/${note.id}`} className="font-medium text-navy-700 hover:underline">
            Open the note
          </Link>{" "}
          and use &ldquo;Release only part&rdquo;.
        </p>
      </div>
      <div className="flex gap-2 border-t border-line px-5 py-3.5">
        <button type="submit" disabled={pending || note.lines.length === 0} className="h-11 flex-1 rounded-xl bg-emerald-600 text-sm font-semibold text-[#ffffff] transition hover:bg-emerald-700 disabled:opacity-60">
          {pending ? "Releasing…" : "Confirm and release"}
        </button>
        <button type="button" className="btn-secondary h-11 px-5" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * Wraps the Pickups list: pressing Release on a row opens ONE pop-up here (not inside the row, so it stays after the list refreshes under it), listing what
 * will leave the stock and asking to confirm. No need to open the note first (Nino 2026-11-08).
 */
export function ReleaseHost({ children }: { children: React.ReactNode }) {
  const [note, setNote] = useState<ListNote | null>(null);
  return (
    <Ctx.Provider value={setNote}>
      {children}
      <Modal open={note !== null} onClose={() => setNote(null)} label="Release the goods">
        {note && <Dialog key={note.id} note={note} onClose={() => setNote(null)} />}
      </Modal>
    </Ctx.Provider>
  );
}

export function ReleaseTrigger({ note }: { note: ListNote }) {
  const open = useContext(Ctx);
  return (
    <button type="button" className="btn-primary btn-sm" onClick={() => open(note)}>
      Release
    </button>
  );
}

/** The same pop-up for the scanner page: scan the pickup note, the goods are listed here, one tap confirms. "Scan next" closes it and keeps the camera going. */
export function ReleasePopup({ note, onClose }: { note: ListNote | null; onClose: () => void }) {
  return (
    <Modal open={note !== null} onClose={onClose} label="Release the goods">
      {note && <Dialog key={note.id} note={note} onClose={onClose} onNext={onClose} />}
    </Modal>
  );
}
