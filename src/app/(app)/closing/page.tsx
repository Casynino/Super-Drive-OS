import Link from "next/link";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { Banknote, CalendarCheck, CheckCircle2, Clock, DoorOpen, ExternalLink, Landmark, Receipt, Scale, Smartphone, TrendingUp } from "lucide-react";
import CloseDayButton from "@/components/cash/CloseDayButton";
import { DepositForm } from "@/components/cash/CashForms";
import { Difference } from "@/components/cash/Display";
import { ColumnsChart, DonutChart, TopProductsChart } from "@/components/dashboard/Charts";
import BarList from "@/components/reports/BarList";
import KpiCard from "@/components/dashboard/KpiCard";
import { Alert, PageHeader } from "@/components/ui";
import { Prisma } from "@/generated/prisma/client";
import { can } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { getClosingPreview, unclosedDays, type ClosingSummary } from "@/lib/cash/closing";
import { getMoneySummary } from "@/lib/cash/summary";
import { getProductsSold, getProfit, getSalesByHour, getSalesPerDay } from "@/lib/reports/period";
import { businessDay, defaultLocationId, getAccountBalances, listAccounts } from "@/lib/cash/ledger";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { getCurrency } from "@/lib/settings";
import { cn, formatDate } from "@/lib/utils";
import ClosingsSection, { closingCorrections } from "./ClosingsSection";
import { recordDepositAction, submitClosingAction } from "./actions";

export const metadata = { title: "Closing" };

/**
 * Closing (count the cash, send it to the boss's account, close; it does not have to be the same day). The shop person's page is short: today's numbers, the cash in the till, and one button that opens the closing pop-up
 * (count, bank, close). The list of closed days is its own page (Past days). The owner's page is the list of every day.
 */
export default async function ClosingPage({ searchParams }: { searchParams: Promise<{ show?: string; shop?: string; banked?: string }> }) {
  const user = await requireUser();
  const canSubmit = can(user, "closing.submit");
  const canReview = can(user, "closing.approve");
  const canDeposit = can(user, "deposits.record");
  if (!canSubmit && !canReview) redirect("/forbidden");
  const sp = await searchParams;
  const currency = await getCurrency();
  const money = (v: Prisma.Decimal | string | number) => formatMoney(v, currency);
  const today = businessDay();
  const locationId = await defaultLocationId(db);
  const show = sp.show === "short" || sp.show === "extra" ? sp.show : undefined;
  const monthStart = new Date(`${today.slice(0, 8)}01T00:00:00Z`);

  const [preview, older, last, accounts, monthBanked] = await Promise.all([
    canSubmit ? getClosingPreview(db, locationId, today) : Promise.resolve(null),
    canSubmit ? unclosedDays(db, locationId, today) : Promise.resolve([] as string[]),
    db.dailyClosing.findFirst({ where: canReview ? {} : { submittedById: user.id }, orderBy: { businessDate: "desc" } }),
    getAccountBalances(db, locationId, today),
    canReview ? db.bankDeposit.aggregate({ where: { businessDate: { gte: monthStart } }, _sum: { amount: true } }) : Promise.resolve(null),
  ]);
  const seeProfit = can(user, "dashboard.financials") || can(user, "reports.financial");
  const monthYmd = `${today.slice(0, 8)}01`;
  const monthProfit = canReview && seeProfit ? await getProfit(db, (await getMoneySummary(db, locationId, { from: monthYmd, to: today })).expenses, monthYmd, today) : null;
  // the owner's "cash short this month", after the owner's own corrections
  const monthRows = canReview ? await db.dailyClosing.findMany({ where: { businessDate: { gte: monthStart } }, select: { closingNo: true, difference: true } }) : [];
  const monthCorr = await closingCorrections(monthRows.map((c) => c.closingNo));
  const monthNet = monthRows.map((c) => c.difference.plus(monthCorr.get(c.closingNo) ?? 0)).filter((d) => d.lt(0));
  const monthShortSum = monthNet.reduce((t, d) => t.plus(d.abs()), new Prisma.Decimal(0));
  // the shop person sees today (hour by hour, best sellers) and his own latest closings, never the business totals over many days
  const chart = { symbol: currency.symbol, decimals: currency.decimals };
  const hours = canSubmit ? await getSalesByHour(db, locationId, today) : [];
  const soldToday = canSubmit ? (await getProductsSold(db, locationId, today, today)).slice(0, 6) : [];
  const byHour = new Map(hours.map((h) => [h.hour, h]));
  const firstHour = Math.min(7, ...hours.map((h) => h.hour));
  const lastHour = Math.max(18, ...hours.map((h) => h.hour));
  const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "am" : "pm"}`;
  const hourBars = Array.from({ length: lastHour - firstHour + 1 }, (_, i) => ({ name: hourLabel(firstHour + i), value: Number(byHour.get(firstHour + i)?.total ?? 0) }));
  const salesCount = hours.reduce((t, h) => t + h.count, 0);
  const busiest = hours.reduce<(typeof hours)[number] | null>((b, h) => (b === null || h.total.gt(b.total) ? h : b), null);
  const recent = canSubmit ? await db.dailyClosing.findMany({ where: { submittedById: user.id }, orderBy: { businessDate: "desc" }, take: 7 }) : [];
  const recentSales = recent.length ? new Map((await getSalesPerDay(db, locationId, recent[recent.length - 1]!.businessDate.toISOString().slice(0, 10), recent[0]!.businessDate.toISOString().slice(0, 10))).map((d) => [d.day, d.total])) : new Map<string, Prisma.Decimal>();
  const recentCorr = await closingCorrections(recent.map((c) => c.closingNo));
  // after the day is closed everything starts again from zero (new money goes into tomorrow's closing); only the cash left in the till carries forward
  const closedInfo =
    preview?.closed
      ? await (async () => {
          const closing = await db.dailyClosing.findUnique({ where: { id: preview.closed!.id }, select: { submittedAt: true, countedCash: true, difference: true } });
          const banked = await db.bankDeposit.aggregate({ where: { closingId: preview.closed!.id }, _sum: { amount: true } });
          const since = closing ? await db.sale.aggregate({ where: { locationId, status: "COMPLETED", createdAt: { gt: closing.submittedAt } }, _sum: { total: true, returnedTotal: true }, _count: true }) : null;
          const bankedNow = new Prisma.Decimal(banked._sum.amount ?? 0);
          return { closing, banked: bankedNow, left: closing ? closing.countedCash.minus(bankedNow) : new Prisma.Decimal(0), soldSince: new Prisma.Decimal(since?._sum.total ?? 0).minus(since?._sum.returnedTotal ?? 0), salesSince: since?._count ?? 0 };
        })()
      : null;
  const sinceBy = (m: "MOBILE_MONEY" | "BANK") => new Prisma.Decimal(preview?.summary.accounts.find((a) => a.method === m)?.in ?? 0);
  const cash = accounts.find((a) => a.method === "CASH");
  const bankAccounts = (await listAccounts(db, locationId)).filter((a) => a.method === "BANK");
  const others = accounts.filter((a) => a.method !== "CASH" && a.status === "ACTIVE");

  return (
    <>
      {canSubmit && preview ? (
        <DayHeader
          date={preview.closed ? `Closing for ${new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${today}T00:00:00Z`))}` : preview.lastClosedDay ? `Since the last closing · ${formatDate(`${preview.lastClosedDay}T00:00:00Z`)}` : "Your first closing"}
          state={
            preview.closed
              ? { tone: "closed", title: `Closed${closedInfo?.closing ? ` at ${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" }).format(closedInfo.closing.submittedAt)}` : ""}`, detail: preview.closed.closingNo }
              : older.length > 0
                ? { tone: "waiting", title: "Waiting to be closed", detail: `Includes cash from ${older.length === 1 ? formatDate(`${older[0]}T00:00:00Z`) : `${older.length} earlier days`}` }
                : { tone: "open", title: "Ready to close", detail: "Close whenever you have counted the cash" }
          }
        />
      ) : (
        <PageHeader title="Closing" description="Every closing, with any cash that was short." />
      )}

      {sp.banked && (
        <div className="mb-4">
          <Alert kind="success">
            Deposit <strong>{sp.banked}</strong> is recorded. The cash left the till and entered the bank account.
          </Alert>
        </div>
      )}

      {canReview && (
        <div className="mb-5 grid gap-3 sm:gap-4 [grid-template-columns:repeat(auto-fit,minmax(12.5rem,1fr))]">
          <KpiCard icon={Scale} tone={monthNet.length > 0 ? "red" : "green"} label="Cash short this month" value={money(monthShortSum)} hint={monthNet.length > 0 ? `On ${monthNet.length} day${monthNet.length === 1 ? "" : "s"}` : "No cash missing"} href={monthNet.length > 0 ? "/closing?show=short" : undefined} />
          {monthProfit && <KpiCard icon={TrendingUp} tone={monthProfit.net.lt(0) ? "red" : "green"} label={monthProfit.net.lt(0) ? "Loss this month" : "Profit this month"} value={money(monthProfit.net.abs())} badge={`${monthProfit.marginPct.toFixed(1)}% of sales`} hint="Sales profit minus expenses" />}
          <KpiCard icon={Banknote} tone="yellow" label="Cash in the till" value={money(cash?.balance ?? 0)} hint="Now" />
          <KpiCard icon={Landmark} tone="navy" label="Banked this month" value={money(monthBanked?._sum.amount ?? 0)} hint="Cash taken to the bank" />
          <KpiCard icon={CalendarCheck} tone={last && !last.difference.isZero() ? "red" : "green"} label="Last closing" value={last ? formatDate(last.businessDate) : "—"} hint={last ? (last.difference.isZero() ? "No difference" : last.difference.lt(0) ? `Short ${money(last.difference.abs())}` : `Extra ${money(last.difference)}`) : "No day closed yet"} />
        </div>
      )}

      {canSubmit && preview && (
        <section className="mb-6 space-y-5">
          {preview.closed && closedInfo ? (
            <>
              <div className="card flex flex-wrap items-center justify-between gap-3 border-emerald-300/60 bg-emerald-50/70 px-4 py-4 sm:px-5">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 text-emerald-600" size={22} />
                  <div>
                    <p className="font-semibold text-emerald-900">Closing done</p>
                    <p className="text-sm text-emerald-800">{preview.closed.closingNo}. The boss has the report and the money. Everything below starts again from zero; new money goes into the next closing.</p>
                  </div>
                </div>
                <Link href={`/closing/${preview.closed.id}`} className="btn-primary">
                  See the report
                </Link>
              </div>
              <div className="grid gap-3 sm:gap-4 [grid-template-columns:repeat(auto-fit,minmax(11.5rem,1fr))]">
                <KpiCard icon={Banknote} tone="yellow" label="Cash in the till" value={money(preview.expectedCash)} hint={`Carried forward · left at closing ${money(closedInfo.left)}`} />
                <KpiCard icon={Receipt} tone="navy" label="Sold since closing" value={money(closedInfo.soldSince)} hint={`${closedInfo.salesSince} sale${closedInfo.salesSince === 1 ? "" : "s"}`} />
                <KpiCard icon={Smartphone} tone="green" label="Mobile money since closing" value={money(sinceBy("MOBILE_MONEY"))} hint="Nothing to count" />
                <KpiCard icon={Landmark} tone="blue" label="Bank since closing" value={money(sinceBy("BANK"))} hint="Nothing to count" />
              </div>
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
                <section className="card px-4 py-4 sm:px-5" aria-label="How the closing went">
                  <h2 className="text-sm font-semibold text-slate-900">How the closing went</h2>
                  <dl className="mt-3 space-y-1.5 text-sm">
                    <StatementRow label="Cash counted" value={money(closedInfo.closing?.countedCash ?? 0)} />
                    <StatementRow sign="−" label="Sent to the boss's account" value={money(closedInfo.banked)} />
                  </dl>
                  <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-line pt-3">
                    <span className="text-sm font-semibold text-slate-900">Left in the till (the balance)</span>
                    <span className="text-lg font-bold tabular-nums text-slate-900">{money(closedInfo.left)}</span>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">The difference when you counted: {closedInfo.closing ? <Difference value={closedInfo.closing.difference.toString()} currency={currency} /> : "—"}</p>
                  {canDeposit && bankAccounts.length > 0 && (
                    <div className="mt-4 border-t border-line pt-4">
                      <h3 className="mb-3 text-sm font-semibold text-slate-900">Send more cash to the boss's account</h3>
                      <DepositForm key={sp.banked ?? "new"} action={recordDepositAction} submissionKey={randomUUID()} cashBalance={money(cash?.balance ?? 0)} bankAccounts={bankAccounts} />
                    </div>
                  )}
                </section>
                <CashStatementCard title="Cash in the till now" summary={preview.summary} expected={preview.expectedCash} money={money} />
              </div>
            </>
          ) : (
            <>
              <div className="grid gap-3 sm:gap-4 [grid-template-columns:repeat(auto-fit,minmax(11.5rem,1fr))]">
                <KpiCard icon={Receipt} tone="navy" label={`Sold today · ${formatDate(`${today}T00:00:00Z`)}`} value={money(preview.summary.sales.total)} hint={`${preview.summary.sales.count} sale${preview.summary.sales.count === 1 ? "" : "s"}${Number(preview.summary.sales.creditGiven) > 0 ? ` · ${money(preview.summary.sales.creditGiven)} on credit` : ""}`} />
                <KpiCard icon={Banknote} tone="yellow" label="Cash expected in the till" value={money(preview.expectedCash)} hint={`Start ${money(preview.summary.cash.opening)} + in − out`} />
                {others.map((a) => (
                  <KpiCard key={a.id} icon={a.method === "BANK" ? Landmark : Smartphone} tone={a.method === "BANK" ? "blue" : "green"} label={a.name} value={money(a.balance)} hint={`Received today ${money(a.inToday)} · nothing to count`} />
                ))}
              </div>
            </>
          )}

          {!preview.closed && (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px] xl:grid-rows-[auto_1fr]">
            {!preview.closed && (
              <section className="card flex flex-col justify-between gap-4 px-5 py-5 xl:col-start-2 xl:row-start-1" aria-label="Closing">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Should be in the till</p>
                  <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">{money(preview.expectedCash)}</p>
                  <p className="mt-2 text-sm text-slate-500">Count the cash, send it to the boss's account and close. What you keep in the till is the balance you start the next time with.</p>
                </div>
                <div className="space-y-2">
                  <CloseDayButton className="h-12 w-full text-base" action={submitClosingAction} day={today} expected={preview.expectedCash.toString()} symbol={currency.symbol} canDeposit={canDeposit} submissionKey={randomUUID()} bankAccounts={bankAccounts} />
                  <p className="text-xs text-slate-500">A closing cannot be changed. The boss gets the report.</p>
                </div>
              </section>
            )}

            <section className="card flex flex-col px-4 py-4 sm:px-5 xl:col-start-1 xl:row-start-1" aria-label="Sales today by the hour">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">Sales today, hour by hour</h2>
                <span className="text-xs text-slate-500">{salesCount} sale{salesCount === 1 ? "" : "s"} so far</span>
              </div>
              <div className="mt-3 h-52">
                <ColumnsChart data={hourBars} money={chart} label="Sold" empty="No sales yet today" />
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-3 border-t border-line pt-3 text-sm">
                <Fact label="Sales today" value={String(salesCount)} />
                <Fact label="Average sale" value={salesCount > 0 ? money(Math.round(Number(preview.summary.sales.total) / salesCount)) : "—"} />
                <Fact label="Busiest hour" value={busiest ? hourLabel(busiest.hour) : "—"} note={busiest ? money(busiest.total) : undefined} />
              </dl>
            </section>

            {!preview.closed && (
              <>
                <CashStatementCard className="xl:col-start-2 xl:row-start-2" title="Cash in the till today" summary={preview.summary} expected={preview.expectedCash} money={money} />

                <div className="grid gap-5 md:grid-cols-2 xl:col-start-1 xl:row-start-2">
                  <MoneyInToday summary={preview.summary} money={money} chart={chart} />
                  <section className="card px-4 py-4 sm:px-5" aria-label="Spent today">
                    <div className="flex items-baseline justify-between gap-2">
                      <h2 className="text-sm font-semibold text-slate-900">Spent today</h2>
                      <span className="text-sm font-bold tabular-nums text-slate-900">{money(preview.summary.expenses.total)}</span>
                    </div>
                    <div className="mt-4">
                      <BarList tone="red" empty="Nothing spent today." rows={preview.summary.expenses.byCategory.map((c) => ({ label: c.name, value: Number(c.amount), text: money(c.amount) }))} />
                    </div>
                  </section>
                </div>
              </>
            )}
          </div>
          )}

          <div className={preview.closed ? "" : "grid gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"}>
            {!preview.closed && (
            <section className="card flex flex-col px-4 py-4 sm:px-5" aria-label="Best sellers">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">Best sellers today</h2>
                <span className="text-xs text-slate-500">by amount sold</span>
              </div>
              <div className="mt-3 h-64">
                <TopProductsChart data={soldToday.map((p) => ({ name: p.name, value: Number(p.revenue) }))} money={chart} empty="No sales yet today" />
              </div>
            </section>
            )}

            <section className="card overflow-hidden" aria-label="Recent days">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
                <h2 className="text-sm font-semibold text-slate-900">Your last closings</h2>
                <Link href="/closing/history" className="text-sm font-medium text-navy-700 hover:underline">
                  All past closings
                </Link>
              </div>
              {recent.length === 0 ? (
                <p className="border-t border-line px-5 py-10 text-center text-sm text-slate-500">No closing yet. Each closing appears here.</p>
              ) : (
                <div className="table-wrap border-t border-line">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Day</th>
                        <th className="hidden text-right sm:table-cell">Sold</th>
                        <th className="text-right">Counted</th>
                        <th>Difference</th>
                        <th className="text-right">Report</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recent.map((c) => {
                        const day = c.businessDate.toISOString().slice(0, 10);
                        const sold = recentSales.get(day) ?? (c.summary as unknown as ClosingSummary).sales?.total ?? 0;
                        const net = c.difference.plus(recentCorr.get(c.closingNo) ?? 0);
                        return (
                          <tr key={c.id}>
                            <td>
                              <Link href={`/closing/${c.id}`} className="whitespace-nowrap font-medium text-navy-700 hover:underline">
                                {formatDate(c.businessDate)}
                              </Link>
                            </td>
                            <td className="hidden text-right tabular-nums sm:table-cell">{money(sold)}</td>
                            <td className="text-right font-medium tabular-nums">{money(c.countedCash)}</td>
                            <td>
                              <Difference value={net.toString()} currency={currency} />
                            </td>
                            <td className="text-right">
                              <Link href={`/closing/${c.id}`} className="btn-secondary btn-sm">
                                <ExternalLink size={14} /> Open
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </section>
      )}

      {/* the owner's page is the list itself; the shop person finds it under "Past days" */}
      {!canSubmit && <ClosingsSection user={user} show={show} shop={sp.shop} basePath="/closing" />}
    </>
  );
}

function StatementRow({ label, value, sign }: { label: string; value: string; sign?: "+" | "−" }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-slate-600">
        {sign && <span className="mr-1.5 inline-block w-3 text-center font-semibold text-slate-400">{sign}</span>}
        {label}
      </dt>
      <dd className="tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 truncate text-base font-bold tabular-nums text-slate-900" title={value}>
        {value}
      </dd>
      {note && <p className="text-[11px] text-slate-500">{note}</p>}
    </div>
  );
}

/** Money that came in today, by how it was paid (sales paid at the sale plus debts collected), with what was left on credit. */
function MoneyInToday({ summary, money, chart }: { summary: ClosingSummary; money: (v: Prisma.Decimal | string | number) => string; chart: { symbol: string; decimals: number } }) {
  const pm = summary.sales.paidByMethod;
  const cm = summary.collections.byMethod;
  const by = (k: "CASH" | "MOBILE_MONEY" | "BANK") => Number(pm[k]) + Number(cm[k]);
  const data = [
    { name: "Cash", value: by("CASH") },
    { name: "Mobile money", value: by("MOBILE_MONEY") },
    { name: "Bank", value: by("BANK") },
  ].filter((d) => d.value > 0);
  const total = by("CASH") + by("MOBILE_MONEY") + by("BANK");
  return (
    <section className="card flex flex-col px-4 py-4 sm:px-5" aria-label="Money in today">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Money in today</h2>
        <span className="text-sm font-bold tabular-nums text-slate-900">{money(total)}</span>
      </div>
      <div className="mt-2 h-44">
        <DonutChart data={data} money={chart} centre={money(total)} centreLabel="Received" empty="Nothing received yet today" />
      </div>
      <dl className="mt-3 space-y-1.5 border-t border-line pt-3 text-sm">
        <StatementRow label="Paid at the sale" value={money(Number(pm.CASH) + Number(pm.MOBILE_MONEY) + Number(pm.BANK))} />
        <StatementRow label="Debts collected" value={money(summary.collections.total)} />
        <StatementRow label="Sold on credit (not paid yet)" value={money(summary.sales.creditGiven)} />
      </dl>
    </section>
  );
}

/** The cash in the till as a short statement: where it started, what came in and went out, what should be there now. */
function CashStatementCard({ title, summary, expected, money, className }: { title: string; summary: ClosingSummary; expected: Prisma.Decimal; money: (v: Prisma.Decimal | string | number) => string; className?: string }) {
  const c = summary.cash;
  return (
    <section className={`card px-4 py-4 sm:px-5 ${className ?? ""}`} aria-label={title}>
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      <dl className="mt-3 space-y-1.5 text-sm">
        <StatementRow label="Left at the last closing" value={money(c.opening)} />
        <StatementRow sign="+" label="Cash sales" value={money(c.salesIn)} />
        <StatementRow sign="+" label="Debts collected in cash" value={money(c.collectionsIn)} />
        {Number(c.refundsOut) !== 0 && <StatementRow sign="−" label="Refunds paid" value={money(c.refundsOut)} />}
        <StatementRow sign="−" label="Cash expenses" value={money(c.expensesOut)} />
        {Number(c.withdrawals) !== 0 && <StatementRow sign="−" label="Taken out by the owner" value={money(c.withdrawals)} />}
        {Number(c.transfers ?? 0) !== 0 && <StatementRow sign={Number(c.transfers) < 0 ? "−" : "+"} label="Moved to or from other accounts" value={money(Math.abs(Number(c.transfers)))} />}
        {Number(c.supplierPayments ?? 0) !== 0 && <StatementRow sign="−" label="Paid to suppliers" value={money(c.supplierPayments ?? "0")} />}
        {Number(c.depositsOut) !== 0 && <StatementRow sign="−" label="Sent to the bank since" value={money(c.depositsOut)} />}
        {Number(c.corrections) !== 0 && <StatementRow sign={Number(c.corrections) < 0 ? "−" : "+"} label="Corrections by the owner" value={money(Math.abs(Number(c.corrections)))} />}
      </dl>
      <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-line pt-3">
        <span className="text-sm font-semibold text-slate-900">Should be in the till</span>
        <span className="text-lg font-bold tabular-nums text-slate-900">{money(expected)}</span>
      </div>
    </section>
  );
}

/** The top of the shop person's page: the date, the name, and where the day stands (open, waiting to be closed, closed). */
function DayHeader({ date, state }: { date: string; state: { tone: "open" | "waiting" | "closed"; title: string; detail: string } }) {
  const t = {
    open: { box: "border-emerald-500/30 bg-emerald-500/[0.07]", icon: "bg-emerald-500/15 text-emerald-500", Icon: DoorOpen },
    waiting: { box: "border-amber-500/35 bg-amber-500/[0.08]", icon: "bg-amber-500/15 text-amber-500", Icon: Clock },
    closed: { box: "border-slate-500/30 bg-slate-500/[0.07]", icon: "bg-slate-500/15 text-slate-500", Icon: CheckCircle2 },
  }[state.tone];
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{date}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Closing</h1>
      </div>
      <div className={cn("flex max-w-full items-center gap-3 rounded-xl border px-3 py-2", t.box)}>
        <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", t.icon)}>
          <t.Icon size={18} aria-hidden />
        </span>
        <div className="min-w-0 leading-tight">
          <p className="text-sm font-semibold text-slate-900">{state.title}</p>
          <p className="mt-0.5 text-xs text-slate-500">{state.detail}</p>
        </div>
      </div>
    </div>
  );
}
