import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CheckCircle2, Landmark } from "lucide-react";
import { ClosingStatusBadge, ClosingSummaryView, Difference } from "@/components/cash/Display";
import { ReviewClosingForm } from "@/components/cash/CashForms";
import { Alert, PageHeader } from "@/components/ui";
import type { ClosingSummary } from "@/lib/cash/closing";
import { can } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { getCurrency } from "@/lib/settings";
import { formatDate, formatDateTime } from "@/lib/utils";
import { reviewClosingAction } from "../actions";

export const metadata = { title: "Closing" };

function Figure({ label, children, strong }: { label: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <div className="card card-pad">
      <p className="text-[13px] font-medium text-slate-500">{label}</p>
      <p className={`mt-1.5 tracking-tight text-slate-900 ${strong ? "text-2xl font-semibold" : "text-xl font-semibold"}`}>{children}</p>
    </div>
  );
}

export default async function ClosingDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string }> }) {
  const user = await requireUser();
  const canSubmit = can(user, "closing.submit");
  const canReview = can(user, "closing.approve");
  if (!canSubmit && !canReview) redirect("/forbidden");
  const { id } = await params;
  const sp = await searchParams;
  const c = await db.dailyClosing.findUnique({ where: { id }, include: { submittedBy: { select: { name: true } }, reviewedBy: { select: { name: true } } } });
  if (!c || (!canReview && c.submittedById !== user.id)) notFound();
  const [currency, deposits] = await Promise.all([getCurrency(), db.bankDeposit.findMany({ where: { closingId: c.id }, include: { createdBy: { select: { name: true } } } })]);
  const summary = c.summary as unknown as ClosingSummary;

  return (
    <>
      <PageHeader
        title={`Closing · ${formatDate(c.businessDate)}`}
        back={{ href: "/closing", label: "Daily closing" }}
        description={`${c.closingNo} · submitted by ${c.submittedBy.name} on ${formatDateTime(c.submittedAt)}`}
        actions={<ClosingStatusBadge status={c.status} difference={c.difference.toString()} />}
      />

      {sp.done && (
        <div className="mb-4">
          <Alert kind="success">
            <span className="flex items-center gap-2">
              <CheckCircle2 size={16} /> The day is closed and locked. The owner has been told.
            </span>
          </Alert>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <Figure label="Cash at the start">{formatMoney(c.openingCash, currency)}</Figure>
        <Figure label="Should be in the till">{formatMoney(c.expectedCash, currency)}</Figure>
        <Figure label="Counted" strong>
          {formatMoney(c.countedCash, currency)}
        </Figure>
        <Figure label="Difference">
          <Difference value={c.difference.toString()} currency={currency} className="text-lg" />
        </Figure>
        <Figure label="Left in the till">{formatMoney(c.cashCarried, currency)}</Figure>
      </div>

      {c.notes && (
        <div className="card card-pad mb-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Attendant&apos;s note</p>
          <p className="mt-1 text-sm text-slate-800">“{c.notes}”</p>
        </div>
      )}

      {deposits.length > 0 && (
        <div className="card card-pad mb-5">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            <Landmark size={15} /> Bank deposit made with this closing
          </h2>
          {deposits.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                <strong>{formatMoney(d.amount, currency)}</strong> · reference <strong>{d.bankReference}</strong> · {d.depositNo}
              </span>
              {d.slipId && (
                <a href={`/api/attachment/${d.slipId}`} target="_blank" rel="noreferrer" className="text-navy-700 hover:underline">
                  See the slip photo
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <ClosingSummaryView s={summary} currency={currency} />
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          {c.status === "REVIEWED" ? (
            <section className="card card-pad">
              <h2 className="text-base font-semibold text-slate-900">Reviewed</h2>
              <p className="mt-1 text-sm text-slate-600">
                {c.reviewedBy?.name} · {formatDateTime(c.reviewedAt)}
              </p>
              {c.reviewNote && <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">“{c.reviewNote}”</p>}
            </section>
          ) : canReview ? (
            <section className="card card-pad">
              <h2 className="mb-1 text-base font-semibold text-slate-900">{c.status === "NEEDS_REVIEW" ? "This count did not match" : "Sign off"}</h2>
              <p className="mb-3 text-sm text-slate-500">
                {c.status === "NEEDS_REVIEW" ? "Look into the difference with the attendant, then write down what you found." : "Mark this day as checked. The figures stay exactly as they are."}
              </p>
              <ReviewClosingForm closingId={c.id} action={reviewClosingAction} needsNote={c.status === "NEEDS_REVIEW"} />
            </section>
          ) : c.status === "NEEDS_REVIEW" ? (
            <Alert kind="info">The owner has been told about the difference and will look at it.</Alert>
          ) : null}
          <Link href="/closing" className="btn-secondary w-full justify-center">
            All closings
          </Link>
        </aside>
      </div>
    </>
  );
}
