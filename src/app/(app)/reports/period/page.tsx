import Link from "next/link";
import { redirect } from "next/navigation";
import { Banknote, Receipt, ReceiptText, Scale, TrendingUp } from "lucide-react";
import KpiCard from "@/components/dashboard/KpiCard";
import Spread from "@/components/reports/Spread";
import { PageHeader } from "@/components/ui";
import { Prisma } from "@/generated/prisma/client";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { businessDay, defaultLocationId } from "@/lib/cash/ledger";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { changeText, getPeriodStats, shiftDay } from "@/lib/reports/period";
import { getCurrency } from "@/lib/settings";
import { cn, formatDate } from "@/lib/utils";

export const metadata = { title: "Business report" };

const isDate = (s?: string) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));
const D = Prisma.Decimal;

/** The business report of a week or a month: the page the WhatsApp links open. Everything comes from recorded transactions. */
export default async function PeriodReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const user = await requireUser();
  if (!canAny(user, ["reports.view", "reports.financial"])) redirect("/forbidden");
  const sp = await searchParams;
  const today = businessDay();
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  const weekStart = shiftDay(today, -((dow + 6) % 7));
  const monthStart = `${today.slice(0, 8)}01`;
  const prevMonthEnd = shiftDay(monthStart, -1);
  const periods = [
    { label: "This week", from: weekStart, to: today },
    { label: "Last week", from: shiftDay(weekStart, -7), to: shiftDay(weekStart, -1) },
    { label: "This month", from: monthStart, to: today },
    { label: "Last month", from: `${prevMonthEnd.slice(0, 8)}01`, to: prevMonthEnd },
  ];
  const from = isDate(sp.from) ? sp.from! : weekStart;
  const to = isDate(sp.to) && sp.to! >= from ? sp.to! : isDate(sp.from) ? from : today;
  const active = periods.find((p) => p.from === from && p.to === to);
  const currency = await getCurrency();
  const money = (v: Prisma.Decimal | number | string) => formatMoney(v, currency);
  const s = await getPeriodStats(db, await defaultLocationId(db), from, to);
  const seeProfit = can(user, "dashboard.financials") || can(user, "reports.financial");
  const change = changeText(s.sales.total, s.sales.previousTotal);
  const best = s.sales.perDay.reduce((m, d) => (d.total.gt(m.total) ? d : m), { day: "", total: new D(0), count: 0 });

  // every day of the period, so quiet days show as empty bars
  const bars: { day: string; total: Prisma.Decimal }[] = [];
  for (let d = from; d <= to && bars.length < 62; d = shiftDay(d, 1)) bars.push({ day: d, total: s.sales.perDay.find((x) => x.day === d)?.total ?? new D(0) });
  const peak = bars.reduce((m, b) => (b.total.gt(m) ? b.total : m), new D(0));

  return (
    <>
      <PageHeader title="Business report" back={{ href: "/reports", label: "Reports" }} description={`${formatDate(`${from}T00:00:00Z`)} to ${formatDate(`${to}T00:00:00Z`)}`} />

      <nav className="-mx-1 mb-4 flex flex-wrap gap-1.5 px-1" aria-label="Period">
        {periods.map((p) => (
          <Link key={p.label} href={`/reports/period?from=${p.from}&to=${p.to}`} aria-current={active === p ? "page" : undefined} className={cn("inline-flex shrink-0 items-center rounded-full border px-3.5 py-1.5 text-sm font-medium transition", active === p ? "border-navy-700 bg-navy-700 text-white" : "border-line bg-white text-slate-600 hover:border-navy-200 hover:text-slate-900")}>
            {p.label}
          </Link>
        ))}
      </nav>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
        <KpiCard icon={Receipt} tone="navy" label="Sold" value={money(s.sales.total)} hint={`${s.sales.count} sale${s.sales.count === 1 ? "" : "s"}${change ? ` · ${change}` : ""}`} />
        <KpiCard icon={Banknote} tone="green" label="Income" value={money(s.money.income)} hint={`${s.money.payments} payment${s.money.payments === 1 ? "" : "s"} received`} />
        <KpiCard icon={ReceiptText} tone="red" label="Spent" value={money(s.money.spent)} hint={`Expenses ${money(s.money.expenses)} · suppliers ${money(s.money.suppliers)} · owner ${money(s.money.withdrawals)}`} />
        <KpiCard icon={TrendingUp} tone={s.money.left.lt(0) ? "red" : "green"} label="What is left" value={money(s.money.left)} hint="Income − everything spent" />
        {seeProfit && <KpiCard icon={TrendingUp} tone={s.profit.net.lt(0) ? "red" : "green"} label="Profit" value={money(s.profit.net)} badge={`${s.profit.marginPct.toFixed(1)}% of sales`} hint={`Sales profit ${money(s.profit.gross)} − expenses ${money(s.money.expenses)}`} />}
        <KpiCard icon={Scale} tone={s.closings.short.gt(0) ? "red" : "green"} label="Cash count" value={s.closings.short.gt(0) ? `Short ${money(s.closings.short)}` : "No cash missing"} hint={`${s.closings.count} of ${s.closings.daysInPeriod} days closed${s.closings.extra.gt(0) ? ` · extra ${money(s.closings.extra)}` : ""}${s.closings.needReview ? ` · ${s.closings.needReview} to review` : ""}`} href="/closing" />
      </div>

      <section className="card mb-5 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Sales by day</h2>
          {best.total.gt(0) && <p className="text-xs text-slate-500">Best day: {formatDate(`${best.day}T00:00:00Z`)} · {money(best.total)}</p>}
        </div>
        {peak.gt(0) ? (
          <div className="mt-4 flex h-40 items-end gap-1 sm:gap-1.5" role="img" aria-label="Sales for every day of the period">
            {bars.map((b) => (
              <div key={b.day} className="group flex h-full min-w-0 flex-1 flex-col justify-end" title={`${formatDate(`${b.day}T00:00:00Z`)}: ${money(b.total)}`}>
                <div className={cn("w-full rounded-t-md transition", b.day === best.day ? "bg-oil-400" : "bg-navy-500 group-hover:bg-navy-400")} style={{ height: `${Math.max(b.total.div(peak).mul(100).toNumber(), b.total.gt(0) ? 3 : 0)}%` }} />
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-500">No sales in this period.</p>
        )}
        {bars.length <= 14 && (
          <div className="mt-1.5 flex gap-1 sm:gap-1.5">
            {bars.map((b) => (
              <span key={b.day} className="min-w-0 flex-1 truncate text-center text-[11px] text-slate-500">
                {new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(`${b.day}T12:00:00Z`))}
              </span>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Spread title="How customers paid at the sale" parts={[{ name: "Cash", value: s.paidAtSale.CASH }, { name: "Mobile money", value: s.paidAtSale.MOBILE_MONEY }, { name: "Bank", value: s.paidAtSale.BANK }, { name: "On credit", value: s.sales.creditGiven }]} money={money} empty="No sales in this period." />
        <Spread title="Where the money went" parts={s.expensesByCategory} money={money} empty="No expenses in this period." />
        <Spread title="Best sellers" parts={s.topProducts} money={money} empty="No sales in this period." />
        <section className="card px-4 py-4 sm:px-5">
          <h2 className="text-sm font-semibold text-slate-900">Cash and bank</h2>
          <dl className="mt-3 space-y-2 text-sm">
            {[
              ["Debts collected", s.collected],
              ["Taken to the bank", s.banked],
              ["Taken out by the owner", s.money.withdrawals],
              ["Paid to suppliers", s.money.suppliers],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex items-baseline justify-between gap-3 border-b border-line/70 pb-2 last:border-b-0 last:pb-0">
                <dt className="text-slate-500">{String(label)}</dt>
                <dd className="font-semibold tabular-nums text-slate-900">{money(value as Prisma.Decimal)}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </>
  );
}
