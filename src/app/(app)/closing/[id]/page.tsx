import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { ArrowDownRight, ArrowUpRight, Banknote, Boxes, CheckCircle2, Download, Landmark, Lock, Printer, Receipt, ReceiptText, Scale, TrendingUp } from "lucide-react";
import CorrectClosingForm from "@/components/cash/CorrectClosingForm";
import { ClosingStatusBadge, ClosingSummaryView } from "@/components/cash/Display";
import KpiCard from "@/components/dashboard/KpiCard";
import Spread from "@/components/reports/Spread";
import { Alert, PageHeader } from "@/components/ui";
import { Prisma } from "@/generated/prisma/client";
import type { ClosingSummary } from "@/lib/cash/closing";
import { can } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { getStockAlerts } from "@/lib/inventory/alerts";
import { qtyText } from "@/lib/qty";
import { getPeriodStats, getSalesPerDay, shiftDay } from "@/lib/reports/period";
import { formatMoney } from "@/lib/money";
import { getCurrency } from "@/lib/settings";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { correctClosingAction } from "../actions";

export const metadata = { title: "End of day report" };

const D = Prisma.Decimal;

export default async function ClosingDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string }> }) {
  const user = await requireUser();
  const canSubmit = can(user, "closing.submit");
  const canReview = can(user, "closing.approve");
  if (!canSubmit && !canReview) redirect("/forbidden");
  const { id } = await params;
  const sp = await searchParams;
  const c = await db.dailyClosing.findUnique({ where: { id }, include: { submittedBy: { select: { name: true } }, location: { select: { name: true } } } });
  if (!c || (!canReview && c.submittedById !== user.id)) notFound();
  const day = c.businessDate.toISOString().slice(0, 10);
  const [currency, deposits] = await Promise.all([getCurrency(), db.bankDeposit.findMany({ where: { closingId: c.id }, include: { createdBy: { select: { name: true } } } })]);
  const seeProfit = can(user, "dashboard.financials") || can(user, "reports.financial");
  const [perDay, alerts] = await Promise.all([getSalesPerDay(db, c.locationId, shiftDay(day, -62), day), getStockAlerts(db)]);
  // the day's sales, money and profit come from the records of that day; the cash count, deposit and corrections below are the locked closing
  const today = await getPeriodStats(db, c.locationId, day, day);
  const profit = seeProfit ? today.profit : null;
  const corrections = await db.cashTransaction.findMany({ where: { type: "ADJUSTMENT", referenceType: "Manual", referenceNo: c.closingNo, account: { locationId: c.locationId, method: "CASH" } }, orderBy: { createdAt: "asc" }, include: { user: { select: { name: true } } } });
  const correctedBy = corrections.reduce((t, x) => t.plus(x.amount), new D(0));
  const into = deposits.length ? await db.cashTransaction.findMany({ where: { type: "DEPOSIT_IN", referenceType: "BankDeposit", referenceId: { in: deposits.map((d) => d.id) } }, select: { referenceId: true, account: { select: { name: true, accountNumber: true } } } }) : [];
  const summary = c.summary as unknown as ClosingSummary;
  const money = (v: Prisma.Decimal | string | number) => formatMoney(v, currency);
  const dec = (v: string | undefined) => new D(v ?? 0);

  const banked = deposits.reduce((t, d) => t.plus(d.amount), new D(0));
  // where the money was when the day was closed: the till after the bank trip, mobile money, and the bank (with what was just banked)
  const methodBalance = (m: "MOBILE_MONEY" | "BANK") => dec(summary.accounts.find((a) => a.method === m)?.balance);
  const mobileLeft = methodBalance("MOBILE_MONEY");
  const bankLeft = methodBalance("BANK").plus(banked);
  const tillLeft = c.cashCarried.plus(correctedBy);
  const everything = tillLeft.plus(mobileLeft).plus(bankLeft);

  // how this day compares: the days around it, the week and the month so far, against the same stretch before
  const bySales = new Map(perDay.map((d) => [d.day, d.total]));
  const at = (d: string) => bySales.get(d) ?? new D(0);
  const sumRange = (from: string, to: string) => {
    let t = new D(0);
    for (let d = from; d <= to; d = shiftDay(d, 1)) t = t.plus(at(d));
    return t;
  };
  const that = at(day);
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  const weekStart = shiftDay(day, -((dow + 6) % 7));
  const monthStart = `${day.slice(0, 8)}01`;
  const prevMonthEnd = shiftDay(monthStart, -1);
  const prevMonthStart = `${prevMonthEnd.slice(0, 8)}01`;
  const sameDayLastMonth = shiftDay(prevMonthStart, Number(day.slice(8)) - 1);
  const avg7 = sumRange(shiftDay(day, -7), shiftDay(day, -1)).div(7);
  const avg30 = sumRange(shiftDay(day, -30), shiftDay(day, -1)).div(30);
  const weekSoFar = sumRange(weekStart, day);
  const monthSoFar = sumRange(monthStart, day);
  const pct = (now: Prisma.Decimal, before: Prisma.Decimal) => (before.gt(0) ? Math.round(now.minus(before).div(before).mul(100).toNumber()) : null);
  const compare = [
    { label: "This day against the last 7 days", value: that, change: pct(that, avg7), hint: `A usual day was ${money(avg7)}` },
    { label: "This day against the last 30 days", value: that, change: pct(that, avg30), hint: `A usual day was ${money(avg30)}` },
    { label: "This week so far", value: weekSoFar, change: pct(weekSoFar, sumRange(shiftDay(weekStart, -7), shiftDay(day, -7))), hint: "Against the same days last week" },
    { label: "This month so far", value: monthSoFar, change: pct(monthSoFar, sumRange(prevMonthStart, sameDayLastMonth > prevMonthEnd ? prevMonthEnd : sameDayLastMonth)), hint: "Against the same days last month" },
  ];
  const bars: { day: string; total: Prisma.Decimal }[] = [];
  for (let i = 13; i >= 0; i--) bars.push({ day: shiftDay(day, -i), total: at(shiftDay(day, -i)) });
  const peak = bars.reduce((m, b) => (b.total.gt(m) ? b.total : m), new D(0));

  return (
    <>
      <PageHeader title={`End of day · ${formatDate(c.businessDate)}`} back={{ href: "/closing", label: "End of day" }} description={`${c.location.name} · ${c.closingNo} · submitted by ${c.submittedBy.name}, ${formatDateTime(c.submittedAt)}`} actions={<><ClosingStatusBadge status={c.status} difference={c.difference.toString()} /><Link href={`/print/closing/${c.id}?print=1`} target="_blank" className="btn-secondary !px-3" title="Print" aria-label="Print">
              <Printer size={16} />
            </Link>
            <Link href={`/print/closing/${c.id}?print=1&save=1`} target="_blank" className="btn-primary !px-3" title="Download as PDF" aria-label="Download as PDF">
              <Download size={16} />
            </Link></>} />

      {sp.done && (
        <div className="mb-4">
          <Alert kind="success">
            <span className="flex items-center gap-2">
              <CheckCircle2 size={16} /> The day is closed and locked. The owner has been told.
            </span>
          </Alert>
        </div>
      )}

      <div className="mb-5 grid gap-3 sm:gap-4 [grid-template-columns:repeat(auto-fit,minmax(12rem,1fr))]">
        <KpiCard icon={Receipt} tone="navy" label="Sold" value={money(today.sales.total)} hint={`${today.sales.count} sale${today.sales.count === 1 ? "" : "s"}${today.sales.creditGiven.gt(0) ? ` · ${money(today.sales.creditGiven)} on credit` : ""}`} />
        <KpiCard icon={Banknote} tone="green" label="Money received" value={money(today.money.income)} hint={`${today.money.payments} payment${today.money.payments === 1 ? "" : "s"} · at the sale and on debts`} />
        <KpiCard icon={ReceiptText} tone="red" label="Spent on expenses" value={money(today.money.expenses)} hint={`${today.expensesByCategory.length} categor${today.expensesByCategory.length === 1 ? "y" : "ies"}`} />
        {profit && <KpiCard icon={TrendingUp} tone={profit.net.lt(0) ? "red" : "green"} label={profit.net.lt(0) ? "Loss" : "Profit"} value={money(profit.net.abs())} badge={`${profit.marginPct.toFixed(1)}% of sales`} hint={`Sales profit ${money(profit.gross)} − expenses ${money(today.money.expenses)}`} />}
        {(() => {
          const net = c.countedCash.plus(correctedBy).minus(c.expectedCash);
          const fixed = !correctedBy.isZero();
          return (
            <KpiCard
              icon={Scale}
              tone={net.isZero() ? "green" : net.lt(0) ? "red" : "yellow"}
              label="Cash count"
              value={net.isZero() ? (fixed ? "Corrected" : "Correct") : `${net.lt(0) ? "Short" : "Extra"} ${money(net.abs())}`}
              hint={fixed ? `Was ${c.difference.lt(0) ? "short" : "extra"} ${money(c.difference.abs())} at closing` : `Counted ${money(c.countedCash)} · expected ${money(c.expectedCash)}`}
            />
          );
        })()}
      </div>

      {can(user, "cash.adjust") && !c.countedCash.plus(correctedBy).minus(c.expectedCash).isZero() && (() => {
        const off = c.countedCash.plus(correctedBy).minus(c.expectedCash);
        return (
          <section className={`card mb-5 overflow-hidden border-l-4 ${off.lt(0) ? "border-l-brand-red" : "border-l-oil-400"}`} aria-label="The cash did not match">
            <div className="px-4 py-4 sm:px-5">
              <h2 className="text-base font-semibold text-slate-900">
                The cash did not match: {off.lt(0) ? "short" : "extra"} {money(off.abs())}
              </h2>
              <p className="mt-0.5 text-sm text-slate-600">
                Counted {money(c.countedCash.plus(correctedBy))} · the system expected {money(c.expectedCash)}. If the shop recounted or the cash turned up, correct it here: it is saved with your reason and shown in the report.
              </p>
              <div className="mt-4">
                <CorrectClosingForm action={correctClosingAction} closingId={c.id} current={c.countedCash.plus(correctedBy).toString()} expected={c.expectedCash.toString()} symbol={currency.symbol} submissionKey={randomUUID()} />
              </div>
            </div>
          </section>
        );
      })()}

      <section className="card mb-5 px-4 py-4 sm:px-5" aria-label="Where the money is">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Where the money was when the day closed</h2>
          <span className="text-sm font-semibold tabular-nums text-slate-900">{money(everything)} in all</span>
        </div>
        <dl className="mt-3 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]">
          {[
            ["In the till (cash)", tillLeft, banked.gt(0) ? `after ${money(banked)} went to the bank` : "nothing was banked"],
            ["Mobile money", mobileLeft, "in the mobile money accounts"],
            ["In the bank", bankLeft, banked.gt(0) ? `includes ${money(banked)} banked today` : "in the bank accounts"],
          ].map(([label, value, note]) => (
            <div key={String(label)} className="rounded-xl border border-line px-3.5 py-3">
              <dt className="text-xs text-slate-500">{String(label)}</dt>
              <dd className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{money(value as Prisma.Decimal)}</dd>
              <p className="mt-0.5 text-[11px] text-slate-500">{String(note)}</p>
            </div>
          ))}
        </dl>
      </section>

      <section className="card mb-5 px-4 py-4 sm:px-5" aria-label="How this day compares">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">How this day compares</h2>
          <p className="text-xs text-slate-500">Sales, last 14 days · this day in yellow</p>
        </div>
        {peak.gt(0) ? (
          <>
            <div className="mt-4 flex h-36 items-end gap-1 sm:gap-1.5" role="img" aria-label="Sales of the last 14 days">
              {bars.map((b) => (
                <div key={b.day} className="group flex h-full min-w-0 flex-1 flex-col justify-end" title={`${formatDate(`${b.day}T00:00:00Z`)}: ${money(b.total)}`}>
                  <div className={cn("w-full rounded-t-md transition", b.day === day ? "bg-oil-400" : "bg-navy-500 group-hover:bg-navy-400")} style={{ height: `${Math.max(b.total.div(peak).mul(100).toNumber(), b.total.gt(0) ? 3 : 0)}%` }} />
                </div>
              ))}
            </div>
            <div className="mt-1.5 flex gap-1 sm:gap-1.5">
              {bars.map((b) => (
                <span key={b.day} className={cn("min-w-0 flex-1 truncate text-center text-[10px]", b.day === day ? "font-semibold text-slate-800" : "text-slate-500")}>
                  {b.day.slice(8)}
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className="mt-3 text-sm text-slate-500">No sales in the last 14 days.</p>
        )}
        <dl className="mt-4 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
          {compare.map((x) => (
            <div key={x.label} className="rounded-xl border border-line px-3.5 py-3">
              <dt className="text-xs text-slate-500">{x.label}</dt>
              <dd className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{money(x.value)}</dd>
              <p className={cn("mt-0.5 flex items-center gap-1 text-xs", x.change === null ? "text-slate-500" : x.change >= 0 ? "font-medium text-emerald-700" : "font-medium text-brand-red-dark")}>
                {x.change === null ? null : x.change >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                {x.change === null ? x.hint : `${x.change >= 0 ? "Up" : "Down"} ${Math.abs(x.change)}% · ${x.hint}`}
              </p>
            </div>
          ))}
        </dl>
      </section>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Spread title="Where the money came in" parts={today.money.byAccount.map((a) => ({ name: a.name, value: a.income }))} money={money} empty="No money came in today." />
        <Spread title="Spent today" parts={today.expensesByCategory} money={money} empty="Nothing was spent." />
        <Spread title="Best sellers" parts={today.topProducts} money={money} empty="No sales today." />

        <section className="card px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Boxes size={15} /> Stock to watch
            </h2>
            <Link href="/inventory" className="text-xs text-navy-700 hover:underline">
              See all stock
            </Link>
          </div>
          {alerts.out.length === 0 && alerts.low.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">Every product is above its minimum.</p>
          ) : (
            <ul className="mt-3 space-y-1.5 text-sm">
              {alerts.out.slice(0, 5).map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-slate-800">{a.name}</span>
                  <span className="badge-red shrink-0">Out of stock</span>
                </li>
              ))}
              {alerts.low.slice(0, 5).map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-slate-800">{a.name}</span>
                  <span className="badge-yellow shrink-0">{qtyText(Number(a.qty), a.pack, a.symbol).main} left</span>
                </li>
              ))}
            </ul>
          )}
          {alerts.out.length + alerts.low.length > 10 && <p className="mt-2 text-xs text-slate-500">And {alerts.out.length + alerts.low.length - 10} more.</p>}
        </section>

        <section className="card px-4 py-4 sm:px-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Landmark size={15} /> Taken to the bank
          </h2>
          {deposits.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">Nothing was banked. {money(c.cashCarried)} stays in the till.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {deposits.map((d) => {
                const acc = into.find((r) => r.referenceId === d.id)?.account;
                return (
                  <div key={d.id} className="flex items-start gap-3">
                    {d.slipId && (
                      <a href={`/api/attachment/${d.slipId}`} target="_blank" rel="noreferrer" className="shrink-0" title="Open the slip">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/attachment/${d.slipId}`} alt="Deposit slip" className="h-20 w-16 rounded-lg border border-line object-cover" />
                      </a>
                    )}
                    <div className="min-w-0 text-sm">
                      <p className="text-lg font-bold tabular-nums text-slate-900">{money(d.amount)}</p>
                      <p className="text-slate-600">
                        into <strong>{acc?.name ?? "the bank"}</strong>
                        {acc?.accountNumber ? ` · ${acc.accountNumber}` : ""}
                      </p>
                      <p className="text-xs text-slate-500">
                        Ref {d.bankReference} · {d.depositNo} · {d.createdBy.name}
                        {!d.slipId && " · no slip photo"}
                      </p>
                    </div>
                  </div>
                );
              })}
              <p className="text-xs text-slate-500">
                {money(c.cashCarried)} stays in the till{banked.gt(0) ? "" : ""}.
              </p>
            </div>
          )}
        </section>
      </div>

      {c.notes && (
        <div className="card card-pad mb-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Note from the shop</p>
          <p className="mt-1 text-sm text-slate-800">“{c.notes}”</p>
        </div>
      )}

      {(corrections.length > 0 || can(user, "cash.adjust")) && (
        <section className="card mb-5 px-4 py-4 sm:px-5" aria-label="Corrections">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">Corrections after closing</h2>
            {corrections.length > 0 && <span className="text-sm text-slate-500">Cash counted now {money(c.countedCash.plus(correctedBy))}</span>}
          </div>
          {corrections.length > 0 && (
            <ul className="mt-3 divide-y divide-line/70 text-sm">
              {corrections.map((x) => (
                <li key={x.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2">
                  <span className="min-w-0 text-slate-700">
                    {(x.description ?? "").replace(/^Correction \((added|removed)\): /, "")}
                    <span className="block text-xs text-slate-500">
                      {x.user.name} · {formatDateTime(x.createdAt)}
                    </span>
                  </span>
                  <span className={x.amount.lt(0) ? "font-semibold tabular-nums text-brand-red-dark" : "font-semibold tabular-nums text-emerald-700"}>
                    {x.amount.gt(0) ? "+ " : "− "}
                    {money(x.amount.abs())}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {can(user, "cash.adjust") && (
            <details className="group mt-3">
              <summary className="inline-flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-navy-700 hover:underline">Correct this day&apos;s cash</summary>
              <div className="mt-3">
                <CorrectClosingForm action={correctClosingAction} closingId={c.id} current={c.countedCash.plus(correctedBy).toString()} expected={c.expectedCash.toString()} symbol={currency.symbol} submissionKey={randomUUID()} />
              </div>
            </details>
          )}
        </section>
      )}

      <h2 className="mb-3 text-base font-semibold text-slate-900">The day in figures</h2>
      <ClosingSummaryView s={summary} currency={currency} />
      <p className="mt-5 flex items-center gap-2 text-xs text-slate-500">
        <Lock size={13} /> This record is locked. It cannot be edited or deleted, so it stays as the permanent record of the day.
      </p>
      <div className="mt-3">
        <Link href="/closing" className="btn-secondary">
          All closings
        </Link>
      </div>
    </>
  );
}
