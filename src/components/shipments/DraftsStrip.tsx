"use client";

import Link from "next/link";
import { FileClock, Trash2 } from "lucide-react";

export type DraftRow = { id: string; products: number; detail: string; savedText: string };

/** The orders the boss started and saved to finish later. Nothing in them has been sent: the shop does not see them. */
export default function DraftsStrip({ drafts, discard }: { drafts: DraftRow[]; discard: (fd: FormData) => Promise<void> }) {
  if (drafts.length === 0) return null;
  return (
    <section aria-label="Drafts" className="card mb-5 overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <FileClock size={16} className="text-slate-500" aria-hidden />
        <h2 className="text-sm font-semibold text-slate-900">Drafts</h2>
        <span className="text-xs text-slate-500">saved, not sent to the shop</span>
      </div>
      <ul className="divide-y divide-line">
        {drafts.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900">
                {d.products === 0 ? "Empty draft" : `${d.products} product${d.products === 1 ? "" : "s"}`}
                {d.detail && <span className="font-normal text-slate-500"> · {d.detail}</span>}
              </p>
              <p className="text-xs text-slate-500">Saved {d.savedText}</p>
            </div>
            <div className="flex items-center gap-2">
              <Link href={`/shipments/new?draft=${d.id}`} className="btn-primary btn-sm">
                Continue
              </Link>
              <form
                action={discard}
                onSubmit={(e) => {
                  if (!window.confirm("Delete this draft? The list in it is lost.")) e.preventDefault();
                }}
              >
                <input type="hidden" name="id" value={d.id} />
                <button type="submit" className="btn-secondary btn-sm" aria-label="Delete this draft">
                  <Trash2 size={14} />
                </button>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
