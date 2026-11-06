"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { UNIT_COOKIE, type UnitMode } from "@/lib/qty";
import { cn } from "@/lib/utils";

/** CTN | PCS switch (like the dark/light button): how quantities are shown on every screen. Cartons are the default. */
export default function UnitToggle({ mode }: { mode: UnitMode }) {
  const router = useRouter();
  const [current, setCurrent] = useState(mode);
  const [pending, start] = useTransition();
  const pick = (next: UnitMode) => {
    if (next === current) return;
    setCurrent(next);
    document.cookie = `${UNIT_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    start(() => router.refresh());
  };
  return (
    <div className={cn("inline-flex rounded-lg border border-line bg-white p-0.5 text-xs font-semibold", pending && "opacity-70")} role="group" aria-label="Show quantities in">
      {(["ctn", "pcs"] as const).map((m) => (
        <button key={m} type="button" onClick={() => pick(m)} aria-pressed={current === m} title={m === "ctn" ? "Show quantities in cartons" : "Show quantities in pieces"} className={cn("rounded-md px-2.5 py-1 transition", current === m ? "bg-navy-700 text-white" : "text-slate-600 hover:text-slate-900")}>
          {m === "ctn" ? "CTN" : "PCS"}
        </button>
      ))}
    </div>
  );
}
