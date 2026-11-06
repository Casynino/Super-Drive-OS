import Link from "next/link";
import { cn } from "@/lib/utils";

export type WingaTone = "red" | "yellow" | "green" | "blue" | "slate";

/** One word for where a winga stands: late, has open invoices, holding stock, settled, new or inactive. */
export function wingaStatus(i: { inactive: boolean; lateInvoices: number; openInvoices: number; holdsStock: boolean; reports: number }): { key: "late" | "owing" | "stock" | "settled" | "new" | "inactive"; label: string; tone: WingaTone } {
  if (i.inactive) return { key: "inactive", label: "Inactive", tone: "slate" };
  if (i.lateInvoices > 0) return { key: "late", label: `${i.lateInvoices} late`, tone: "red" };
  if (i.openInvoices > 0) return { key: "owing", label: `${i.openInvoices} open`, tone: "yellow" };
  if (i.holdsStock) return { key: "stock", label: "Has stock", tone: "blue" };
  if (i.reports > 0) return { key: "settled", label: "Settled", tone: "green" };
  return { key: "new", label: "New", tone: "slate" };
}

const EDGE: Record<WingaTone, string> = { red: "border-l-brand-red", yellow: "border-l-oil-400", green: "border-l-emerald-500", blue: "border-l-blue-500", slate: "border-l-slate-300" };
export const BADGE: Record<WingaTone, string> ={ red: "badge-red", yellow: "badge-yellow", green: "badge-green", blue: "badge-blue", slate: "badge-gray" };

export const pctTone = (p: number) => (p >= 80 ? "text-emerald-700" : p >= 50 ? "text-yellow-700" : "text-brand-red-dark");

/** A winga on the list: who, where they stand, how well they pay, what they hold and what they owe. Press it to open the full profile. */
export default function WingaCard({
  href,
  name,
  subtitle,
  status,
  onTimePct,
  onTimeOf,
  stockValue,
  stockItems,
  owes,
  owesTone,
  owesHint,
  footer,
}: {
  href: string;
  name: string;
  subtitle: string;
  status: { label: string; tone: WingaTone };
  onTimePct: number | null;
  onTimeOf: number;
  stockValue: string;
  stockItems: string;
  owes: string;
  owesTone: "red" | "normal" | "muted";
  owesHint: string;
  footer: string;
}) {
  return (
    <Link href={href} className={cn("card group block overflow-hidden border-l-4 transition hover:-translate-y-0.5 hover:border-navy-200 hover:shadow-md", EDGE[status.tone])}>
      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold text-slate-900">{name}</h3>
            <span className={BADGE[status.tone]}>{status.label}</span>
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p>
        </div>
        <div className="shrink-0 text-right">
          {onTimePct === null ? (
            <>
              <p className="text-2xl font-bold leading-none text-slate-300">—</p>
              <p className="mt-1 text-[11px] text-slate-500">no payment due yet</p>
            </>
          ) : (
            <>
              <p className={cn("text-2xl font-bold leading-none tabular-nums", pctTone(onTimePct))}>
                {onTimePct}
                <span className="text-sm">%</span>
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                pays on time · {onTimeOf} invoice{onTimeOf === 1 ? "" : "s"}
              </p>
            </>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 border-t border-line">
        <div className="min-w-0 px-4 py-3">
          <p className="text-lg font-bold leading-tight tabular-nums text-slate-900">{stockValue}</p>
          <p className="mt-0.5 text-xs text-slate-500">{stockItems}</p>
        </div>
        <div className="min-w-0 border-l border-line px-4 py-3">
          <p className={cn("text-lg font-bold leading-tight tabular-nums", owesTone === "red" ? "text-brand-red-dark" : owesTone === "muted" ? "text-slate-400" : "text-slate-900")}>{owes}</p>
          <p className={cn("mt-0.5 text-xs", owesTone === "red" ? "font-medium text-brand-red-dark" : "text-slate-500")}>{owesHint}</p>
        </div>
      </div>
      <p className="border-t border-line bg-slate-50/60 px-4 py-2 text-[11px] text-slate-500 group-hover:text-slate-700">{footer}</p>
    </Link>
  );
}
