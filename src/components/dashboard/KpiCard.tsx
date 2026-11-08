import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Only the tones that mean something get a dot; navy and slate are neutral. */
const DOT = { navy: "", slate: "", blue: "bg-blue-500", red: "bg-brand-red", yellow: "bg-oil-400", green: "bg-emerald-500" } as const;

/**
 * One cell of a slim figures strip (Nino 2026-11-09: "I do not like those big cards, make them nice and small, like the Stock overview"): a small
 * label, ONE figure and a line of context. Always used inside a `KpiStrip`, which draws the card and the thin lines between the cells.
 * `badge` is a small word on the right of the label (for example a margin), `active` marks the cell that is the current filter; `icon` is
 * accepted so older call sites still compile, but the slim cell has no icon tile.
 */
export default function KpiCard({
  tone = "navy",
  label,
  value,
  hint,
  badge,
  href,
  active,
}: {
  icon?: LucideIcon;
  tone?: keyof typeof DOT;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  badge?: React.ReactNode;
  href?: string;
  active?: boolean;
}) {
  const body = (
    <div className={cn("h-full border-b border-r border-line bg-white px-4 py-2.5 transition", href && "hover:bg-slate-50", active && "bg-slate-50 shadow-[inset_0_-2px_0_var(--color-navy-500)]")}>
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {DOT[tone] && <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[tone])} />}
        <span className="min-w-0 truncate">{label}</span>
        {badge && <span className="ml-auto shrink-0 rounded-full bg-slate-100 px-1.5 text-[10px] font-semibold normal-case tracking-normal text-slate-600">{badge}</span>}
      </p>
      <p className="mt-0.5 whitespace-nowrap text-base font-semibold leading-tight tabular-nums text-slate-900 sm:text-lg">{value}</p>
      {hint && <p className="mt-0.5 truncate text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full" aria-current={active ? "page" : undefined}>
      {body}
    </Link>
  ) : (
    body
  );
}
