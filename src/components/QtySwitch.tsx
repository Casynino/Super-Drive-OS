"use client";

import type { UnitMode } from "@/lib/qty";
import { cn } from "@/lib/utils";

/** A small CTN | PCS switch for ONE product's numbers (cartons are the default). Safe to put inside a card that is a link. */
export default function QtySwitch({ mode, onChange, className }: { mode: UnitMode; onChange: (m: UnitMode) => void; className?: string }) {
  return (
    <div className={cn("inline-flex rounded-md border border-line bg-white p-0.5 text-[11px] font-semibold", className)} role="group" aria-label="Show this product in">
      {(["ctn", "pcs"] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          title={m === "ctn" ? "Show in cartons" : "Show in pieces"}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onChange(m);
          }}
          className={cn("rounded px-2 py-0.5 transition", mode === m ? "bg-navy-700 text-white" : "text-slate-500 hover:text-slate-900")}
        >
          {m === "ctn" ? "CTN" : "PCS"}
        </button>
      ))}
    </div>
  );
}
