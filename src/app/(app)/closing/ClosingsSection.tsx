import Link from "next/link";
import { Banknote, CalendarCheck, Download, ExternalLink, Landmark, Printer, Receipt, Scale } from "lucide-react";
import { ClosedDaysChart, DifferenceChart } from "@/components/dashboard/Charts";
import KpiCard from "@/components/dashboard/KpiCard";
import { Difference } from "@/components/cash/Display";
import { EmptyState } from "@/components/ui";
import { Prisma } from "@/generated/prisma/client";
import { can } from "@/lib/auth/can";
import type { SessionUser } from "@/lib/auth/session";
import type { ClosingSummary } from "@/lib/cash/closing";
import { defaultLocationId } from "@/lib/cash/ledger";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { getSalesPerDay } from "@/lib/reports/period";
import { getCurrency } from "@/lib/settings";
import { formatDate, formatDateTime } from "@/lib/utils";

/** What the owner corrected after closing, by closing number (cash only). */
export async function closingCorrections(nos: string[]) {
  if (nos.length === 0) return new Map<string, Prisma.Decimal>();
  const rows = await db.cashTransaction.groupBy({ by: ["referenceNo"], where: { type: "ADJUSTMENT", referenceType: "Manual", referenceNo: { in: nos }, account: { method: "CASH" } }, _sum: { amount: true } });
  return new Map(rows.map((r) => [r.referenceNo ?? "", new Prisma.Decimal(r._sum.amount ?? 0)]));
}

/**
 * The list of closed days and the cash taken to the bank. The owner sees every day (with Short / Extra / shop filters); the shop person
 * sees only their own. Used on the owner's Closing page and on the shop person's separate "Deposit history" page.
 */
export default async function ClosingsSection({ user, show, shop, basePath, kpis = false }: { user: SessionUser; show?: "short" | "extra"; shop?: string; basePath: string; /** the number cards on top (the owner's End of day page has its own) */ kpis?: boolean }) {
  const canReview = can(user, "closing.approve");
  const currency = await getCurrency();
  const money = (v: Prisma.Decimal | string | number) => formatMoney(v, currency);
  const locationId = await defaultLocationId(db);
  const where: Prisma.DailyClosingWhereInput = { ...(canReview ? {} : { submittedById: user.id }), ...(shop ? { locationId: shop } : {}), ...(show === "short" ? { difference: { lt: 0 } } : show === "extra" ? { difference: { gt: 0 } } : {}) };
  const depositWhere: Prisma.BankDepositWhereInput = canReview ? {} : { createdById: user.id };
  const [history, deposits, shops] = await Promise.all([
    db.dailyClosing.findMany({ where, orderBy: { businessDate: "desc" }, take: 30, include: { submittedBy: { select: { name: true } }, location: { select: { name: true } } } }),
    db.bankDeposit.findMany({ where: depositWhere, orderBy: { createdAt: "desc" }, take: 12, include: { createdBy: { select: { name: true } } } }),
    db.location.findMany({ where: { type: { not: "RESELLER" }, status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const daysShown = history.map((c) => c.businessDate.toISOString().slice(0, 10));
  const liveSales = daysShown.length ? new Map((await getSalesPerDay(db, locationId, daysShown[daysShown.length - 1]!, daysShown[0]!)).map((d) => [d.day, d.total])) : new Map<string, Prisma.Decimal>();
  // what was sold that day, from the sales records (another shop's days fall back to the figure saved at closing)
  const soldOf = (c: (typeof history)[number]) => (c.locationId === locationId ? (liveSales.get(c.businessDate.toISOString().slice(0, 10)) ?? new Prisma.Decimal(0)) : new Prisma.Decimal((c.summary as unknown as ClosingSummary).sales.total));
  const corrOf = await closingCorrections(history.map((c) => c.closingNo));
  // what reached the bank on each day (a closing's own banking and any deposit made that day), not only what was tied to the closing
  const bankedRows = history.length ? await db.bankDeposit.groupBy({ by: ["businessDate", "locationId"], where: { businessDate: { in: history.map((c) => c.businessDate) }, ...(canReview ? {} : { createdById: user.id }) }, _sum: { amount: true } }) : [];
  const bankedOn = new Map(bankedRows.map((r) => [`${r.locationId}|${r.businessDate.toISOString().slice(0, 10)}`, new Prisma.Decimal(r._sum.amount ?? 0)]));
  // the bank account each deposit went into is the account of its ledger row
  const into = deposits.length ? await db.cashTransaction.findMany({ where: { type: "DEPOSIT_IN", referenceType: "BankDeposit", referenceId: { in: deposits.map((d) => d.id) } }, select: { referenceId: true, account: { select: { name: true } } } }) : [];
  const intoName = new Map(into.map((r) => [r.referenceId, r.account.name]));
  // ── the numbers and charts above the table (oldest day first in the charts)
  const chart = { symbol: currency.symbol, decimals: currency.decimals };
  const dayLabel = (d: Date) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }).format(d);
  const netOf = (c: (typeof history)[number]) => c.difference.plus(corrOf.get(c.closingNo) ?? 0);
  const bankedOf = (c: (typeof history)[number]) => bankedOn.get(`${c.locationId}|${c.businessDate.toISOString().slice(0, 10)}`) ?? new Prisma.Decimal(0);
  const spentOf = (c: (typeof history)[number]) => new Prisma.Decimal((c.summary as unknown as ClosingSummary).expenses?.total ?? 0);
  const oldestFirst = [...history].reverse();
  const soldBars = oldestFirst.map((c) => ({ label: dayLabel(c.businessDate), value: Number(soldOf(c)), short: netOf(c).lt(0) }));
  const diffBars = oldestFirst.map((c) => ({ label: dayLabel(c.businessDate), value: Number(netOf(c)) }));
  const sum = (f: (c: (typeof history)[number]) => Prisma.Decimal) => history.reduce((t, c) => t.plus(f(c)), new Prisma.Decimal(0));
  const soldTotal = sum(soldOf);
  const spentTotal = sum(spentOf);
  const bankedTotal = sum(bankedOf);
  const shortDays = history.filter((c) => netOf(c).lt(0));
  const shortTotal = shortDays.reduce((t, c) => t.plus(netOf(c).abs()), new Prisma.Decimal(0));
  const netTotal = sum(netOf);
  const qs = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.fromEntries(Object.entries(o).filter(([, v]) => v) as [string, string][])).toString();
    return p ? `${basePath}?${p}` : basePath;
  };

  return (
    <>
      {canReview && history.length > 0 && (
        <>
          {kpis && (
            <div className="mb-5 grid gap-3 sm:gap-4 [grid-template-columns:repeat(auto-fit,minmax(12.5rem,1fr))]">
              <KpiCard icon={CalendarCheck} tone="navy" label="Closings" value={String(history.length)} hint={history.length === 30 ? "The latest 30" : "Shown below"} />
              <KpiCard icon={Receipt} tone="green" label="Sold in these days" value={money(soldTotal)} hint={`About ${money(soldTotal.div(history.length).toDecimalPlaces(0))} a day`} />
              <KpiCard icon={Scale} tone={shortDays.length > 0 ? "red" : "green"} label="Cash short" value={money(shortTotal)} hint={shortDays.length > 0 ? `On ${shortDays.length} day${shortDays.length === 1 ? "" : "s"} · net ${netTotal.lt(0) ? "−" : "+"} ${money(netTotal.abs())}` : "No cash was missing"} />
              <KpiCard icon={Landmark} tone="blue" label="Deposited" value={money(bankedTotal)} hint={`Spent ${money(spentTotal)} in these days`} />
            </div>
          )}
          <div className="mb-6 grid gap-4 xl:grid-cols-2">
            <section className="card px-4 py-4 sm:px-5" aria-label="Sales per closed day">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">Sales per closing</h2>
                <span className="text-xs text-slate-500">
                  <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: "var(--c2)" }} /> red = cash was short
                </span>
              </div>
              <div className="mt-3 h-56">
                <ClosedDaysChart data={soldBars} money={chart} />
              </div>
            </section>
            <section className="card px-4 py-4 sm:px-5" aria-label="Cash difference per day">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">Cash counted against expected</h2>
                <span className="text-xs text-slate-500">after the owner&apos;s corrections</span>
              </div>
              <div className="mt-3 h-56">
                <DifferenceChart data={diffBars} money={chart} />
              </div>
            </section>
          </div>
        </>
      )}

      <section className="mb-6">
        {canReview && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">All closings</h2>
          {canReview && (
            <div className="flex gap-1.5 text-sm">
              {[["", "All"], ["short", "Short"], ["extra", "Extra"]].map(([v, label]) => (
                <Link key={v} href={qs({ shop, show: v || undefined })} className={`rounded-full px-3 py-1 ${(show ?? "") === v ? "bg-navy-700 text-white" : "bg-white text-slate-600 ring-1 ring-line hover:bg-slate-50"}`}>
                  {label}
                </Link>
              ))}
            </div>
          )}
        </div>
        )}
        {shops.length > 1 && (
          <nav className="-mx-1 mb-3 flex flex-wrap gap-1.5 px-1" aria-label="Shop">
            {[{ id: "", name: "All shops" }, ...shops].map((x) => (
              <Link key={x.id} href={qs({ shop: x.id || undefined, show })} className={`rounded-full px-3 py-1 text-sm ${(shop ?? "") === x.id ? "bg-navy-700 text-white" : "bg-white text-slate-600 ring-1 ring-line hover:bg-slate-50"}`}>
                {x.name}
              </Link>
            ))}
          </nav>
        )}
        <div className="card overflow-hidden">
          {history.length === 0 ? (
            <EmptyState icon={<CalendarCheck size={22} />} title="No closings yet" description="Each closing appears here." />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Day</th>
                    {shops.length > 1 && <th>Shop</th>}
                    {canReview && <th className="hidden 2xl:table-cell">Closing</th>}
                    <th className="hidden text-right md:table-cell">Sold</th>
                    {canReview && <th className="hidden text-right xl:table-cell">Spent</th>}
                    {canReview && <th className="hidden text-right lg:table-cell">Expected</th>}
                    <th className="text-right">Counted</th>
                    <th>Difference</th>
                    <th className="hidden text-right xl:table-cell">Banked</th>
                    {canReview && <th className="hidden 2xl:table-cell">By</th>}
                    <th className="text-right">Report</th>
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
                      {canReview && <td className="hidden whitespace-nowrap text-slate-500 2xl:table-cell">{c.closingNo}</td>}
                      <td className="hidden text-right tabular-nums md:table-cell">{money(soldOf(c))}</td>
                      {canReview && <td className="hidden text-right tabular-nums text-slate-600 xl:table-cell">{money(spentOf(c))}</td>}
                      {canReview && <td className="hidden text-right tabular-nums text-slate-600 lg:table-cell">{money(c.expectedCash)}</td>}
                      <td className="text-right font-medium tabular-nums">{money(c.countedCash)}</td>
                      <td>
                        {(() => {
                          const corr = corrOf.get(c.closingNo) ?? new Prisma.Decimal(0);
                          const net = c.difference.plus(corr);
                          if (corr.isZero()) return <Difference value={c.difference.toString()} currency={currency} />;
                          return (
                            <>
                              {net.isZero() ? <span className="font-semibold text-emerald-700">OK</span> : <Difference value={net.toString()} currency={currency} />}
                              <span className="block text-xs text-slate-500">was {c.difference.lt(0) ? "−" : "+"} {money(c.difference.abs())}</span>
                            </>
                          );
                        })()}
                      </td>
                      <td className="hidden text-right tabular-nums xl:table-cell">{(() => {
                          const b = bankedOn.get(`${c.locationId}|${c.businessDate.toISOString().slice(0, 10)}`) ?? new Prisma.Decimal(0);
                          return b.gt(0) ? money(b) : <span className="text-slate-400">—</span>;
                        })()}</td>
                      {canReview && (
                        <td className="hidden 2xl:table-cell">
                          {c.submittedBy.name}
                          <span className="block text-xs text-slate-400">{formatDateTime(c.submittedAt)}</span>
                        </td>
                      )}
                      <td className="whitespace-nowrap text-right">
                        <span className="inline-flex items-center gap-1.5">
                          <Link href={`/closing/${c.id}`} className="btn-secondary btn-sm" title="Open the report">
                            <ExternalLink size={14} /> Open
                          </Link>
                          <Link href={`/print/closing/${c.id}?print=1&save=1`} target="_blank" className="btn-secondary btn-sm !px-2" title="Download as PDF" aria-label="Download as PDF">
                            <Download size={15} />
                          </Link>
                          <Link href={`/print/closing/${c.id}?print=1`} target="_blank" className="btn-secondary btn-sm !px-2" title="Print" aria-label="Print">
                            <Printer size={15} />
                          </Link>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {canReview && (
                <tfoot>
                  <tr className="border-t-2 border-line bg-slate-50 font-semibold">
                    <td>Total · {history.length} day{history.length === 1 ? "" : "s"}</td>
                    {shops.length > 1 && <td />}
                    {canReview && <td className="hidden 2xl:table-cell" />}
                    <td className="hidden text-right tabular-nums md:table-cell">{money(soldTotal)}</td>
                    <td className="hidden text-right tabular-nums xl:table-cell">{money(spentTotal)}</td>
                    <td className="hidden lg:table-cell" />
                    <td />
                    <td>{netTotal.isZero() ? <span className="text-emerald-700">OK</span> : <Difference value={netTotal.toString()} currency={currency} />}</td>
                    <td className="hidden text-right tabular-nums xl:table-cell">{money(bankedTotal)}</td>
                    {canReview && <td className="hidden 2xl:table-cell" />}
                    <td />
                  </tr>
                </tfoot>
                )}
              </table>
            </div>
          )}
        </div>
      </section>

      {deposits.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold text-slate-900">Deposits</h2>
          <div className="card overflow-hidden">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Day</th>
                    <th>Into</th>
                    <th>Reference</th>
                    <th className="hidden md:table-cell">Deposited by</th>
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
