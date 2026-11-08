import Link from "next/link";
import { cn } from "@/lib/utils";
import type { CustomerTone } from "@/lib/customers/performance";

const EDGE: Record<CustomerTone, string> = { red: "border-l-brand-red", yellow: "border-l-oil-400", green: "border-l-emerald-500", slate: "border-l-slate-300" };
export const CUSTOMER_BADGE: Record<CustomerTone, string> = { red: "badge-red", yellow: "badge-yellow", green: "badge-green", slate: "badge-gray" };
export const pctTone = (p: number) => (p >= 80 ? "text-emerald-700" : p >= 50 ? "text-yellow-700" : "text-brand-red-dark");

/**
 * A customer on the list: who, where they stand, how well they pay, what they bought and what they owe. The whole card opens the
 * profile; the buttons at the bottom act right here (collect a payment, top up in advance).
 */
export default function CustomerCard({
  href,
  name,
  subtitle,
  status,
  onTimePct,
  onTimeOf,
  left,
  right,
  footer,
  action,
}: {
  href: string;
  name: string;
  subtitle: string;
  status: { label: string; tone: CustomerTone };
  onTimePct: number | null;
  onTimeOf: number;
  /** null hides the figure and its tile (the person may not see it) */
  left: { value: string; hint: string } | null;
  right: { value: string; hint: string; tone: "red" | "normal" | "muted" } | null;
  footer: string;
  action: { href: string; label: string; primary: boolean } | null;
}) {
  return (
    <div className={cn("card group relative flex flex-col overflow-hidden border-l-4 transition hover:border-navy-200", EDGE[status.tone])}>
      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold text-slate-900">
              <Link href={href} className="after:absolute after:inset-0 after:content-[''] hover:text-navy-700">
                {name}
              </Link>
            </h3>
            <span className={CUSTOMER_BADGE[status.tone]}>{status.label}</span>
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p>
        </div>
        {right && (
          <div className="shrink-0 text-right">
            {onTimePct === null ? (
              <>
                <p className="text-2xl font-semibold leading-none text-slate-300">—</p>
                <p className="mt-1 text-[11px] text-slate-500">no payment due yet</p>
              </>
            ) : (
              <>
                <p className={cn("text-2xl font-semibold leading-none tabular-nums", pctTone(onTimePct))}>
                  {onTimePct}
                  <span className="text-sm">%</span>
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  pays on time · {onTimeOf} invoice{onTimeOf === 1 ? "" : "s"}
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {(left || right) && (
        <div className={cn("mt-4 grid border-t border-line", left && right ? "grid-cols-2" : "grid-cols-1")}>
          {left && (
            <div className="min-w-0 px-4 py-3">
              <p className="text-lg font-semibold leading-tight tabular-nums text-slate-900">{left.value}</p>
              <p className="mt-0.5 text-xs text-slate-500">{left.hint}</p>
            </div>
          )}
          {right && (
            <div className={cn("min-w-0 px-4 py-3", left && "border-l border-line")}>
              <p className={cn("text-lg font-semibold leading-tight tabular-nums", right.tone === "red" ? "text-brand-red-dark" : right.tone === "muted" ? "text-slate-400" : "text-slate-900")}>{right.value}</p>
              <p className={cn("mt-0.5 text-xs", right.tone === "red" ? "font-medium text-brand-red-dark" : "text-slate-500")}>{right.hint}</p>
            </div>
          )}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-3 border-t border-line bg-slate-50/60 px-4 py-2">
        <p className="min-w-0 truncate text-[11px] text-slate-500 group-hover:text-slate-700">{footer}</p>
        {action && (
          <Link href={action.href} className={cn("relative z-10 shrink-0", action.primary ? "btn-primary btn-sm" : "btn-secondary btn-sm")}>
            {action.label}
          </Link>
        )}
      </div>
    </div>
  );
}
