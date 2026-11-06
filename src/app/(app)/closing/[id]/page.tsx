import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Banknote, CheckCircle2, Landmark, Lock, Receipt, ReceiptText, Scale } from "lucide-react";
import PrintButton from "@/components/PrintButton";
import { ClosingStatusBadge, ClosingSummaryView } from "@/components/cash/Display";
import KpiCard from "@/components/dashboard/KpiCard";
import Spread from "@/components/reports/Spread";
import { Alert, PageHeader } from "@/components/ui";
import { Prisma } from "@/generated/prisma/client";
import type { ClosingSummary } from "@/lib/cash/closing";
import { can } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { getCurrency } from "@/lib/settings";
import { formatDate, formatDateTime } from "@/lib/utils";

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
  const [currency, deposits, best] = await Promise.all([
    getCurrency(),
    db.bankDeposit.findMany({ where: { closingId: c.id }, include: { createdBy: { select: { name: true } } } }),
    db.$queryRaw<{ name: string; v: Prisma.Decimal | null }[]>`
      SELECT p."name", SUM(si."lineTotal") AS v
        FROM "SaleItem" si JOIN "Sale" s ON s."id" = si."saleId" JOIN "Product" p ON p."id" = si."productId"
       WHERE s."status" = 'COMPLETED' AND s."locationId" = ${c.locationId}
         AND (s."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Dar_es_Salaam')::date = ${day}::date
       GROUP BY p."name" ORDER BY v DESC LIMIT 6`,
  ]);
  const into = deposits.length ? await db.cashTransaction.findMany({ where: { type: "DEPOSIT_IN", referenceType: "BankDeposit", referenceId: { in: deposits.map((d) => d.id) } }, select: { referenceId: true, account: { select: { name: true, accountNumber: true } } } }) : [];
  const summary = c.summary as unknown as ClosingSummary;
  const money = (v: Prisma.Decimal | string | number) => formatMoney(v, currency);
  const dec = (v: string | undefined) => new D(v ?? 0);

  // money that came in during the day: paid at the sale + debts collected, by how it was paid
  const inBy = (k: "CASH" | "MOBILE_MONEY" | "BANK") => dec(summary.sales.paidByMethod[k]).plus(dec(summary.collections.byMethod[k]));
  const received = inBy("CASH").plus(inBy("MOBILE_MONEY")).plus(inBy("BANK"));
  const banked = deposits.reduce((t, d) => t.plus(d.amount), new D(0));
  // where the money was when the day was closed: the till after the bank trip, mobile money, and the bank (with what was just banked)
  const methodBalance = (m: "MOBILE_MONEY" | "BANK") => dec(summary.accounts.find((a) => a.method === m)?.balance);
  const mobileLeft = methodBalance("MOBILE_MONEY");
  const bankLeft = methodBalance("BANK").plus(banked);
  const everything = c.cashCarried.plus(mobileLeft).plus(bankLeft);

  return (
    <>
      <PageHeader title={`End of day · ${formatDate(c.businessDate)}`} back={{ href: "/closing", label: "End of day" }} description={`${c.location.name} · ${c.closingNo} · submitted by ${c.submittedBy.name}, ${formatDateTime(c.submittedAt)}`} actions={<><ClosingStatusBadge status={c.status} difference={c.difference.toString()} /><PrintButton label="Print / Save as PDF" /></>} />

      {sp.done && (
        <div className="mb-4">
          <Alert kind="success">
            <span className="flex items-center gap-2">
              <CheckCircle2 size={16} /> The day is closed and locked. The owner has been told.
            </span>
          </Alert>
        </div>
      )}

      <div className="mb-5 grid gap-3 sm:gap-4 [grid-template-columns:repeat(auto-fit,minmax(14rem,1fr))]">
        <KpiCard icon={Receipt} tone="navy" label="Sold" value={money(summary.sales.total)} hint={`${summary.sales.count} sale${summary.sales.count === 1 ? "" : "s"}${Number(summary.sales.creditGiven) > 0 ? ` · ${money(summary.sales.creditGiven)} on credit` : ""}`} />
        <KpiCard icon={Banknote} tone="green" label="Money received" value={money(received)} hint="Paid at the sale and debts collected" />
        <KpiCard icon={ReceiptText} tone="red" label="Spent" value={money(summary.expenses.total)} hint={`${summary.expenses.byCategory.length} categor${summary.expenses.byCategory.length === 1 ? "y" : "ies"}`} />
        <KpiCard
          icon={Scale}
          tone={c.difference.isZero() ? "green" : c.difference.lt(0) ? "red" : "yellow"}
          label="Cash count"
          value={c.difference.isZero() ? "No difference" : `${c.difference.lt(0) ? "Short" : "Extra"} ${money(c.difference.abs())}`}
          hint={`Counted ${money(c.countedCash)} · expected ${money(c.expectedCash)}`}
        />
      </div>

      <section className="card mb-5 px-4 py-4 sm:px-5" aria-label="Where the money is">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Where the money was when the day closed</h2>
          <span className="text-sm font-semibold tabular-nums text-slate-900">{money(everything)} in all</span>
        </div>
        <dl className="mt-3 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]">
          {[
            ["In the till (cash)", c.cashCarried, banked.gt(0) ? `after ${money(banked)} went to the bank` : "nothing was banked"],
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

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Spread title="Where the money came in" parts={[{ name: "Cash", value: inBy("CASH") }, { name: "Mobile money", value: inBy("MOBILE_MONEY") }, { name: "Bank", value: inBy("BANK") }]} money={money} empty="No money came in today." />
        <Spread title="Spent today" parts={summary.expenses.byCategory.map((x) => ({ name: x.name, value: dec(x.amount) }))} money={money} empty="Nothing was spent." />
        <Spread title="Best sellers" parts={best.map((b) => ({ name: b.name, value: new D(b.v ?? 0) }))} money={money} empty="No sales today." />

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
