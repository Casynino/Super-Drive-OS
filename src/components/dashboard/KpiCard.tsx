import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const TONES = {
  navy: { tile: "bg-navy-50 text-navy-700", bar: "bg-navy-600" },
  blue: { tile: "bg-blue-50 text-blue-700", bar: "bg-blue-500" },
  red: { tile: "bg-brand-red-soft text-brand-red-dark", bar: "bg-brand-red" },
  yellow: { tile: "bg-oil-soft text-yellow-700", bar: "bg-oil-400" },
  green: { tile: "bg-emerald-50 text-emerald-700", bar: "bg-emerald-500" },
  slate: { tile: "bg-slate-100 text-slate-600", bar: "bg-slate-400" },
} as const;

/**
 * A compact number card: coloured top edge, icon tile on the left, label, one big number and a line of context.
 * `badge` is a small pill on the right (for example a margin), `active` outlines the card when it is the current filter.
 */
export default function KpiCard({
  icon: Icon,
  tone = "navy",
  label,
  value,
  hint,
  badge,
  href,
  active,
}: {
  icon: LucideIcon;
  tone?: keyof typeof TONES;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  badge?: React.ReactNode;
  href?: string;
  active?: boolean;
}) {
  const t = TONES[tone];
  const body = (
    <div className={cn("@container card relative h-full overflow-hidden px-4 py-4 transition", href && "hover:-translate-y-0.5 hover:border-navy-200 hover:shadow-md", active && "border-navy-500 ring-1 ring-navy-500/40")}>
      <span className={cn("absolute inset-x-0 top-0 h-[3px]", t.bar)} />
      <div className="flex flex-col items-start gap-2 @[13rem]:flex-row @[13rem]:gap-3.5">
        <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", t.tile)}>
          <Icon size={21} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-[13px] font-medium text-slate-500">{label}</p>
            {badge && <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{badge}</span>}
          </div>
          <p className="mt-0.5 whitespace-nowrap text-[clamp(1.2rem,9cqw,1.75rem)] font-bold leading-tight tracking-tight text-slate-900">{value}</p>
          {hint && <p className="mt-1 text-xs leading-snug text-slate-500">{hint}</p>}
        </div>
      </div>
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
