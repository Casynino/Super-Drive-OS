import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import Sparkline from "./Sparkline";

const TONES = {
  navy: "bg-navy-50 text-navy-700",
  red: "bg-brand-red-soft text-brand-red-dark",
  yellow: "bg-oil-soft text-yellow-700",
  green: "bg-emerald-50 text-emerald-700",
  slate: "bg-slate-100 text-slate-600",
} as const;

const TONE_LINE = { navy: "text-navy-600", red: "text-brand-red", yellow: "text-oil-500", green: "text-emerald-600", slate: "text-slate-500" } as const;

/** A KPI card: coloured icon tile, label, big number, change vs the previous period, and a link to the records behind it. */
export default function StatTile({
  icon: Icon,
  tone = "navy",
  label,
  value,
  hint,
  change,
  href,
  spark,
}: {
  icon: LucideIcon;
  tone?: keyof typeof TONES;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  /** % change vs the previous period; null/undefined = nothing to compare */
  change?: number | null;
  href?: string;
  /** a small trend line along the bottom (one value per day) */
  spark?: number[];
}) {
  const body = (
    <div className={cn("@container card card-pad h-full transition", href && "hover:-translate-y-0.5 hover:border-navy-200 hover:shadow-md")}>
      <div className="flex items-start justify-between gap-3">
        <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", TONES[tone])}>
          <Icon size={22} />
        </span>
        {change !== null && change !== undefined && (
          <span className={cn("inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold", change >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-brand-red-soft text-brand-red-dark")}>
            {change >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            {Math.abs(change).toFixed(change > 99 ? 0 : 1)}%
          </span>
        )}
      </div>
      <p className="mt-3 text-[13px] font-medium text-slate-500">{label}</p>
      <p className="mt-0.5 whitespace-nowrap text-[clamp(1.05rem,12cqw,1.5rem)] font-bold leading-tight tracking-tight text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {spark && <div className="mt-2.5 -mb-1"><Sparkline values={spark} className={TONE_LINE[tone]} /></div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}
