import Link from "next/link";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { AlertTriangle, Banknote, CalendarCheck, CheckCircle2, Landmark, Receipt, Scale, Smartphone, TrendingUp } from "lucide-react";
import ClosingForm from "@/components/cash/ClosingForm";
import { DepositForm } from "@/components/cash/CashForms";
import { ClosingStatusBadge, ClosingSummaryView, Difference } from "@/components/cash/Display";
import KpiCard from "@/components/dashboard/KpiCard";
import { Alert, EmptyState, PageHeader } from "@/components/ui";
import { Prisma } from "@/generated/prisma/client";
import { can } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { getClosingPreview, unclosedDays } from "@/lib/cash/closing";
import { businessDay, defaultLocationId, getAccountBalances, listAccounts } from "@/lib/cash/ledger";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { getCurrency } from "@/lib/settings";
import { formatDate, formatDateTime } from "@/lib/utils";
import { recordDepositAction } from "./actions";
import { submitClosingAction } from "./actions";

export const metadata = { title: "End of day" };

/** Closing: one place for the end of the day. The shop counts the cash, banks some of it and closes; the owner sees every day's report. */
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
  const where: Prisma.DailyClosingWhereInput = { ...(canReview ? {} : { submittedById: user.id }), ...(sp.shop ? { locationId: sp.shop } : {}), ...(show === "short" ? { difference: { lt: 0 } } : show === "extra" ? { difference: { gt: 0 } } : {}) };
  const monthStart = new Date(`${today.slice(0, 8)}01T00:00:00Z`);
  const depositWhere: Prisma.BankDepositWhereInput = canReview ? {} : { createdById: user.id };

  const [preview, older, history, monthShort, accounts, deposits, monthBanked, shops] = await Promise.all([
    canSubmit ? getClosingPreview(db, locationId, today) : Promise.resolve(null),
    canSubmit ? unclosedDays(db, locationId, today) : Promise.resolve([] as string[]),
    db.dailyClosing.findMany({ where, orderBy: { businessDate: "desc" }, take: 30, include: { submittedBy: { select: { name: true } }, location: { select: { name: true } } } }),
    canReview ? db.dailyClosing.aggregate({ where: { businessDate: { gte: monthStart }, difference: { lt: 0 } }, _sum: { difference: true }, _count: true }) : Promise.resolve(null),
    getAccountBalances(db, locationId, today),
    db.bankDeposit.findMany({ where: depositWhere, orderBy: { createdAt: "desc" }, take: 12, include: { createdBy: { select: { name: true } } } }),
    db.bankDeposit.aggregate({ where: { ...depositWhere, businessDate: { gte: new Date(`${today.slice(0, 8)}01T00:00:00Z`) } }, _sum: { amount: true } }),
    db.location.findMany({ where: { type: { not: "RESELLER" }, status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const last = history[0];
  const cash = accounts.find((a) => a.method === "CASH");
  const bankAccounts = (await listAccounts(db, locationId)).filter((a) => a.method === "BANK");
  // the bank account each deposit went into is the account of its ledger row
  const into = deposits.length
    ? await db.cashTransaction.findMany({ where: { type: "DEPOSIT_IN", referenceType: "BankDeposit", referenceId: { in: deposits.map((d) => d.id) } }, select: { referenceId: true, account: { select: { name: true } } } })
    : [];
  const intoName = new Map(into.map((r) => [r.referenceId, r.account.name]));
  const others = accounts.filter((a) => a.method !== "CASH" && a.status === "ACTIVE");

  return (
    <>
      <PageHeader title="End of day" description={canSubmit ? "Count the cash, bank it, close the day." : "Every closed day, with any cash that was short."} />

      {sp.banked && (
        <div className="mb-4">
          <Alert kind="success">
            Deposit <strong>{sp.banked}</strong> is recorded. The cash left the till and entered the bank account.
          </Alert>
        </div>
      )}

      {canReview && (
        <div className="mb-5 grid gap-3 sm:gap-4 [grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))]">
          <KpiCard icon={Scale} tone={monthShort && monthShort._count > 0 ? "red" : "green"} label="Cash short this month" value={money(new Prisma.Decimal(monthShort?._sum.difference ?? 0).abs())} hint={monthShort && monthShort._count > 0 ? `On ${monthShort._count} day${monthShort._count === 1 ? "" : "s"}` : "No cash missing"} href={monthShort && monthShort._count > 0 ? "/closing?show=short" : undefined} />
          <KpiCard icon={Banknote} tone="yellow" label="Cash in the till" value={money(cash?.balance ?? 0)} hint="Now" />
          <KpiCard icon={Landmark} tone="navy" label="Banked this month" value={money(monthBanked._sum.amount ?? 0)} hint="Cash taken to the bank" />
          <KpiCard icon={CalendarCheck} tone={last && !last.difference.isZero() ? "red" : "green"} label="Last closing" value={last ? formatDate(last.businessDate) : "—"} hint={last ? (last.difference.isZero() ? "No difference" : last.difference.lt(0) ? `Short ${money(last.difference.abs())}` : `Extra ${money(last.difference)}`) : "No day closed yet"} />
        </div>
      )}

      {canSubmit && preview && (
        <section className="mb-6">
          {preview.closed ? (
            <div className="card overflow-hidden border-emerald-300/60">
              <div className="flex flex-wrap items-center justify-between gap-3 bg-emerald-50/70 px-4 py-4 sm:px-5">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 text-emerald-600" size={22} />
                  <div>
                    <p className="font-semibold text-emerald-900">Today is closed</p>
                    <p className="text-sm text-emerald-800">{preview.closed.closingNo}. New money goes into tomorrow&apos;s closing.</p>
                  </div>
                </div>
                <Link href={`/closing/${preview.closed.id}`} className="btn-primary">
                  See the report
                </Link>
              </div>
              {canDeposit && bankAccounts.length > 0 && (
                <details className="group border-t border-line">
                  <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-slate-900 sm:px-5">
                    Take more cash to the bank
                    <span className="text-xs font-normal text-slate-500 group-open:hidden">Cash in the till: {money(cash?.balance ?? 0)}</span>
                  </summary>
                  <div className="border-t border-line px-4 py-4 sm:px-5">
                    <DepositForm key={sp.banked ?? "new"} action={recordDepositAction} submissionKey={randomUUID()} cashBalance={money(cash?.balance ?? 0)} bankAccounts={bankAccounts} />
                  </div>
                </details>
              )}
            </div>
          ) : (
            <>
              {older.length > 0 && (
                <div className="mb-4">
                  <Alert kind="info">
                    <span className="flex items-start gap-2">
                      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                      <span>Cash from {older.length === 1 ? "an earlier day" : "earlier days"} ({older.slice(0, 5).map((d) => formatDate(`${d}T00:00:00Z`)).join(", ")}{older.length > 5 ? ` and ${older.length - 5} more` : ""}) was never closed. It is included below.</span>
                    </span>
                  </Alert>
                </div>
              )}
              <div className="mb-5 grid gap-3 sm:gap-4 [grid-template-columns:repeat(auto-fit,minmax(11.5rem,1fr))]">
                <KpiCard icon={Receipt} tone="navy" label={`Sold today · ${formatDate(`${today}T00:00:00Z`)}`} value={money(preview.summary.sales.total)} hint={`${preview.summary.sales.count} sale${preview.summary.sales.count === 1 ? "" : "s"}${Number(preview.summary.sales.creditGiven) > 0 ? ` · ${money(preview.summary.sales.creditGiven)} on credit` : ""}`} />
                <KpiCard icon={Banknote} tone="yellow" label="Cash expected in the till" value={money(preview.expectedCash)} hint={`Start ${money(preview.summary.cash.opening)} + in − out`} />
                {others.map((a) => (
                  <KpiCard key={a.id} icon={a.method === "BANK" ? Landmark : Smartphone} tone={a.method === "BANK" ? "blue" : "green"} label={a.name} value={money(a.balance)} hint={`Received today ${money(a.inToday)} · nothing to count`} />
                ))}
              </div>

              <div className="card px-4 py-5 sm:px-6">
                <ClosingForm action={submitClosingAction} day={today} expected={preview.expectedCash.toString()} symbol={currency.symbol} canDeposit={canDeposit} submissionKey={randomUUID()} bankAccounts={bankAccounts} />
              </div>

              <details className="group mt-4">
                <summary className="inline-flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-navy-700 hover:underline">
                  <TrendingUp size={15} /> See the day&apos;s figures
                </summary>
                <div className="mt-3">
                  <ClosingSummaryView s={preview.summary} currency={currency} />
                </div>
              </details>
            </>
          )}
        </section>
      )}

      <section className="mb-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">{canReview ? "All closings" : "Your closings"}</h2>
          {canReview && (
            <div className="flex gap-1.5 text-sm">
              {[["", "All"], ["short", "Short"], ["extra", "Extra"]].map(([v, label]) => (
                <Link key={v} href={`/closing?${new URLSearchParams({ ...(sp.shop ? { shop: sp.shop } : {}), ...(v ? { show: v } : {}) }).toString()}`} className={`rounded-full px-3 py-1 ${(sp.show ?? "") === v ? "bg-navy-700 text-white" : "bg-white text-slate-600 ring-1 ring-line hover:bg-slate-50"}`}>
                  {label}
                </Link>
              ))}
            </div>
          )}
        </div>
        {shops.length > 1 && (
          <nav className="-mx-1 mb-3 flex flex-wrap gap-1.5 px-1" aria-label="Shop">
            {[{ id: "", name: "All shops" }, ...shops].map((x) => (
              <Link key={x.id} href={`/closing?${new URLSearchParams({ ...(x.id ? { shop: x.id } : {}), ...(show ? { show } : {}) }).toString()}`} className={`rounded-full px-3 py-1 text-sm ${(sp.shop ?? "") === x.id ? "bg-navy-700 text-white" : "bg-white text-slate-600 ring-1 ring-line hover:bg-slate-50"}`}>
                {x.name}
              </Link>
            ))}
          </nav>
        )}
        <div className="card overflow-hidden">
          {history.length === 0 ? (
            <EmptyState icon={<CalendarCheck size={22} />} title="No closings yet" description="Each closed day appears here." />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Day</th>
                    {shops.length > 1 && <th>Shop</th>}
                    <th className="hidden sm:table-cell">Closing</th>
                    <th className="text-right">Expected</th>
                    <th className="text-right">Counted</th>
                    <th>Difference</th>
                    <th className="text-right">Banked</th>
                    <th className="hidden lg:table-cell">By</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/closing/${c.id}`} className="whitespace-nowrap font-medium text-navy-700 hover:underline">
                          {formatDate(c.businessDate)}
                        </Link>
                      </td>
                      {shops.length > 1 && <td className="whitespace-nowrap">{c.location.name}</td>}
                      <td className="hidden text-slate-500 sm:table-cell">{c.closingNo}</td>
                      <td className="text-right tabular-nums">{money(c.expectedCash)}</td>
                      <td className="text-right tabular-nums">{money(c.countedCash)}</td>
                      <td>
                        <Difference value={c.difference.toString()} currency={currency} />
                      </td>
                      <td className="text-right tabular-nums">{c.depositedNow.gt(0) ? money(c.depositedNow) : <span className="text-slate-400">—</span>}</td>
                      <td className="hidden lg:table-cell">
                        {c.submittedBy.name}
                        <span className="block text-xs text-slate-400">{formatDateTime(c.submittedAt)}</span>
                      </td>
                      <td>
                        <ClosingStatusBadge status={c.status} difference={c.difference.toString()} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {deposits.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold text-slate-900">Taken to the bank</h2>
          <div className="card overflow-hidden">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Day</th>
                    <th>Into</th>
                    <th>Reference</th>
                    <th className="hidden md:table-cell">By</th>
                    <th className="text-right">Amount</th>
                    <th className="hidden sm:table-cell">Slip</th>
                  </tr>
                </thead>
                <tbody>
                  {deposits.map((d) => (
                    <tr key={d.id}>
                      <td className="whitespace-nowrap">
                        {d.closingId ? (
                          <Link href={`/closing/${d.closingId}`} className="font-medium text-navy-700 hover:underline">
                            {formatDate(d.businessDate)}
                          </Link>
                        ) : (
                          <span className="font-medium text-slate-800">{formatDate(d.businessDate)}</span>
                        )}
                      </td>
                      <td>{intoName.get(d.id) ?? "Bank"}</td>
                      <td className="text-slate-600">{d.bankReference}</td>
                      <td className="hidden md:table-cell">{d.createdBy.name}</td>
                      <td className="text-right font-medium tabular-nums">{money(d.amount)}</td>
                      <td className="hidden sm:table-cell">
                        {d.slipId ? (
                          <a href={`/api/attachment/${d.slipId}`} target="_blank" rel="noreferrer" className="text-navy-700 hover:underline">
                            View photo
                          </a>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
