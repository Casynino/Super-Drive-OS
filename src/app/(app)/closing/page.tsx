import Link from "next/link";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { AlertTriangle, CalendarCheck, CheckCircle2 } from "lucide-react";
import ClosingForm from "@/components/cash/ClosingForm";
import { ClosingStatusBadge, ClosingSummaryView, Difference } from "@/components/cash/Display";
import { Alert, EmptyState, PageHeader, Stat } from "@/components/ui";
import type { Prisma, ClosingStatus } from "@/generated/prisma/client";
import { can } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { getClosingPreview, unclosedDays } from "@/lib/cash/closing";
import { businessDay, defaultLocationId, getBalances } from "@/lib/cash/ledger";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { getCurrency } from "@/lib/settings";
import { formatDate, formatDateTime } from "@/lib/utils";
import { submitClosingAction } from "./actions";

export const metadata = { title: "Daily Closing" };

export default async function ClosingPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requireUser();
  const canSubmit = can(user, "closing.submit");
  const canReview = can(user, "closing.approve");
  if (!canSubmit && !canReview) redirect("/forbidden");
  const sp = await searchParams;
  const currency = await getCurrency();
  const today = businessDay();
  const locationId = await defaultLocationId(db);

  const statusFilter: ClosingStatus | undefined = sp.status === "NEEDS_REVIEW" || sp.status === "REVIEWED" || sp.status === "SUBMITTED" ? sp.status : undefined;
  const where: Prisma.DailyClosingWhereInput = { ...(canReview ? {} : { submittedById: user.id }), ...(statusFilter ? { status: statusFilter } : {}) };

  const [preview, older, history, needReview, balances] = await Promise.all([
    canSubmit ? getClosingPreview(db, locationId, today) : Promise.resolve(null),
    canSubmit ? unclosedDays(db, locationId, today) : Promise.resolve([] as string[]),
    db.dailyClosing.findMany({ where, orderBy: { businessDate: "desc" }, take: 30, include: { submittedBy: { select: { name: true } } } }),
    canReview ? db.dailyClosing.count({ where: { status: "NEEDS_REVIEW" } }) : Promise.resolve(0),
    canReview ? getBalances(db, locationId, today) : Promise.resolve([]),
  ]);
  const last = history[0];

  return (
    <>
      <PageHeader
        title="Daily Closing"
        description={canSubmit ? "End of the day: check the day's figures, count the cash in the till and close. The system does all the calculations." : "Every day's closing: what the system expected, what was counted, and the difference."}
      />

      {canReview && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Stat label="Waiting for your review" value={needReview} hint={needReview ? "Cash did not match" : "Nothing to review"} />
          <Stat label="Cash on hand" value={formatMoney(balances.find((b) => b.method === "CASH")?.balance ?? 0, currency)} />
          <Stat label="Last closing" value={last ? formatDate(last.businessDate) : "—"} hint={last ? last.closingNo : "No day closed yet"} />
          <Stat label="Last difference" value={last ? <Difference value={last.difference.toString()} currency={currency} className="text-xl" /> : "—"} />
        </div>
      )}

      {canSubmit && preview && (
        <section className="mb-6">
          {preview.closed ? (
            <div className="card card-pad flex flex-wrap items-center justify-between gap-3 border-emerald-200 bg-emerald-50/60">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 text-emerald-600" size={22} />
                <div>
                  <p className="font-semibold text-emerald-900">Today is closed</p>
                  <p className="text-sm text-emerald-800">{preview.closed.closingNo}. Any money that comes in after this goes into tomorrow&apos;s closing.</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Link href={`/closing/${preview.closed.id}`} className="btn-secondary">
                  See today&apos;s closing
                </Link>
                {can(user, "deposits.record") && (
                  <Link href="/deposits" className="btn-primary">
                    Bank deposit
                  </Link>
                )}
              </div>
            </div>
          ) : (
            <>
              {older.length > 0 && (
                <div className="mb-4">
                  <Alert kind="info">
                    <span className="flex items-start gap-2">
                      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                      <span>Cash from {older.length === 1 ? "an earlier day" : "earlier days"} ({older.map((d) => formatDate(`${d}T00:00:00Z`)).join(", ")}) was never closed. It is included in today&apos;s figures below.</span>
                    </span>
                  </Alert>
                </div>
              )}
              <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
                <div>
                  <h2 className="mb-3 text-base font-semibold text-slate-900">Today · {formatDate(`${today}T00:00:00Z`)}</h2>
                  <ClosingSummaryView s={preview.summary} currency={currency} />
                </div>
                <aside className="lg:sticky lg:top-20 lg:self-start">
                  <div className="card">
                    <div className="border-b border-line px-4 py-4 sm:px-5">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cash that should be in the till</p>
                      <p className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">{formatMoney(preview.expectedCash, currency)}</p>
                    </div>
                    <div className="px-4 py-4 sm:px-5">
                      <ClosingForm action={submitClosingAction} day={today} expected={preview.expectedCash.toString()} symbol={currency.symbol} canDeposit={can(user, "deposits.record")} submissionKey={randomUUID()} />
                    </div>
                  </div>
                </aside>
              </div>
            </>
          )}
        </section>
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">{canReview ? "All closings" : "Your closings"}</h2>
          {canReview && (
            <div className="flex gap-1.5 text-sm">
              {[["", "All"], ["NEEDS_REVIEW", "Needs review"], ["REVIEWED", "Reviewed"]].map(([v, label]) => (
                <Link key={v} href={v ? `/closing?status=${v}` : "/closing"} className={`rounded-full px-3 py-1 ${(sp.status ?? "") === v ? "bg-navy-700 text-white" : "bg-white text-slate-600 ring-1 ring-line hover:bg-slate-50"}`}>
                  {label}
                </Link>
              ))}
            </div>
          )}
        </div>
        <div className="card overflow-hidden">
          {history.length === 0 ? (
            <EmptyState icon={<CalendarCheck size={22} />} title="No closings yet" description="Each closed day appears here." />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Day</th>
                    <th className="hidden sm:table-cell">Closing</th>
                    <th className="text-right">Expected</th>
                    <th className="text-right">Counted</th>
                    <th>Difference</th>
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
                      <td className="hidden text-slate-500 sm:table-cell">{c.closingNo}</td>
                      <td className="text-right tabular-nums">{formatMoney(c.expectedCash, currency)}</td>
                      <td className="text-right tabular-nums">{formatMoney(c.countedCash, currency)}</td>
                      <td>
                        <Difference value={c.difference.toString()} currency={currency} />
                      </td>
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
    </>
  );
}
