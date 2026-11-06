import { cn } from "@/lib/utils";

export type BarRow = { label: string; value: number; text: string; note?: string; /** show the note in red (something late or wrong) */ warn?: boolean };

/**
 * A ranked list with a bar behind each figure: the label in full, the bar, the amount. The biggest one is yellow.
 * Used wherever the report ranks things (products, weekdays, expenses, debts), so they all look alike and nothing is cut off.
 */
export default function BarList({ rows, empty = "Nothing in this period yet.", highlightFirst = true, tone = "navy" }: { rows: BarRow[]; empty?: string; highlightFirst?: boolean; tone?: "navy" | "green" | "red" }) {
  if (rows.length === 0) return <p className="py-8 text-center text-sm text-slate-500">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const fill = tone === "green" ? "bg-emerald-500" : tone === "red" ? "bg-rose-500" : "bg-navy-500";
  return (
    <ul className="space-y-3">
      {rows.map((r, i) => (
        <li key={r.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium text-slate-800" title={r.label}>
              {r.label}
            </span>
            <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums text-slate-900">{r.text}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className={cn("h-full rounded-full", highlightFirst && i === 0 ? "bg-oil-400" : fill)} style={{ width: `${Math.max((r.value / max) * 100, r.value > 0 ? 2 : 0)}%` }} />
          </div>
          {r.note && <p className={cn("mt-0.5 text-[11px]", r.warn ? "font-medium text-rose-600" : "text-slate-500")}>{r.note}</p>}
        </li>
      ))}
    </ul>
  );
}
