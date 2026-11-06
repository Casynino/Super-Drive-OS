import { Prisma } from "@/generated/prisma/client";
import { cn } from "@/lib/utils";

const DOTS = ["bg-navy-400", "bg-oil-400", "bg-emerald-500", "bg-violet-500", "bg-sky-500", "bg-orange-400", "bg-brand-red", "bg-slate-400"] as const;
const D = Prisma.Decimal;

/** One stacked bar with a legend: the parts add up to the whole (money by method, spending by category, best sellers). */
export default function Spread({ title, parts, money, empty }: { title: string; parts: { name: string; value: Prisma.Decimal }[]; money: (v: Prisma.Decimal) => string; empty: string }) {
  const shown = parts.filter((p) => p.value.gt(0));
  const total = shown.reduce((t, p) => t.plus(p.value), new D(0));
  return (
    <section className="card px-4 py-4 sm:px-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {shown.length > 0 && <span className="text-sm font-semibold tabular-nums text-slate-900">{money(total)}</span>}
      </div>
      {shown.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{empty}</p>
      ) : (
        <>
          <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={title}>
            {shown.map((p, i) => (
              <span key={p.name} title={`${p.name}: ${money(p.value)}`} className={cn("h-full", DOTS[i % DOTS.length])} style={{ width: `${Math.max(p.value.div(total).mul(100).toNumber(), 1.5)}%` }} />
            ))}
          </div>
          <ul className="mt-3 grid gap-x-4 gap-y-2 [grid-template-columns:repeat(auto-fit,minmax(10rem,1fr))]">
            {shown.map((p, i) => (
              <li key={p.name} className="flex items-start gap-2">
                <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", DOTS[i % DOTS.length])} />
                <span className="min-w-0">
                  <span className="block truncate text-xs text-slate-500">{p.name}</span>
                  <span className="block text-sm font-semibold text-slate-900">{money(p.value)}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
