import { cn } from "@/lib/utils";

const TILE_TONE = { navy: "text-navy-700", green: "text-emerald-700", plain: "text-slate-900" } as const;

/** A small figure with its label, for the performance of a period. */
export function PerfTile({ label, value, sub, tone = "plain" }: { label: string; value: string; sub: string; tone?: keyof typeof TILE_TONE }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-slate-50/60 px-3.5 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn("mt-1 text-xl font-semibold tabular-nums", TILE_TONE[tone])}>{value}</p>
      <p className="mt-0.5 text-xs text-slate-500">{sub}</p>
    </div>
  );
}

/** A percentage with a bar and one line of explanation. */
export function Meter({ label, pct, hint, color, pctClass }: { label: string; pct: number | null; hint: string; color: string; pctClass?: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-slate-800">{label}</span>
        <span className={cn("text-lg font-semibold tabular-nums", pctClass ?? (pct === null ? "text-slate-400" : "text-slate-900"))}>{pct === null ? "—" : `${pct}%`}</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${pct ?? 0}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}
