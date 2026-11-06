import Link from "next/link";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock, ReceiptText, Search, TrendingDown } from "lucide-react";
import { Alert, EmptyState, PageHeader } from "@/components/ui";
import KpiCard from "@/components/dashboard/KpiCard";
import { ExpenseDecisionForm, ExpenseForm } from "@/components/cash/ExpenseForms";
import { ExpenseStatusBadge } from "@/components/cash/Display";
import { Prisma, type ExpenseStatus } from "@/generated/prisma/client";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { businessDay, defaultLocationId, listAccounts } from "@/lib/cash/ledger";
import { getCashSettings } from "@/lib/cash/settings";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { methodLabel } from "@/lib/sales/types";
import { getCurrency } from "@/lib/settings";
import { cn, formatDateTime } from "@/lib/utils";
import { decideExpenseAction, recordExpenseAction } from "./actions";

export const metadata = { title: "Expenses" };

const PAGE_SIZE = 30;
type Search = { status?: string; category?: string; q?: string; from?: string; to?: string; page?: string; recorded?: string; state?: string };
const isDate = (s?: string) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));
const shift = (ymd: string, days: number) => new Date(new Date(`${ymd}T12:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
const ymdOf = (d: Date) => d.toISOString().slice(0, 10);
const dayTitle = (key: string, today: string, yesterday: string) =>
  key === today ? "Today" : key === yesterday ? "Yesterday" : new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));

const STATUS_PILLS: { key: ExpenseStatus | undefined; label: string }[] = [
  { key: undefined, label: "All" },
  { key: "APPROVED", label: "Paid" },
  { key: "PENDING", label: "Waiting for owner's OK" },
  { key: "REJECTED", label: "Rejected" },
  { key: "REVERSED", label: "Reversed" },
];

// Expense | what it was for | by | paid from | amount | status
const COLS = "lg:grid-cols-[minmax(10rem,1fr)_minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,1.1fr)_8rem_11rem]";

/**
 * Expenses: what the shop spent. An expense above the approval limit waits for the owner's OK: nothing leaves an account until it is
 * approved (the owner can do it right here). Totals on top, filters, then the expenses grouped by day.
 */
export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  if (!canAny(user, ["expenses.view", "expenses.create"])) redirect("/forbidden");
  const seeAll = can(user, "expenses.view");
  const canRecord = can(user, "expenses.create");
  const canApprove = can(user, "expenses.approve");
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const today = businessDay();
  const yesterday = shift(today, -1);
  const weekStart = shift(today, -6);
  const monthStart = `${today.slice(0, 8)}01`;
  const q = sp.q?.trim().slice(0, 80) ?? "";
  const status = (["PENDING", "APPROVED", "REJECTED", "REVERSED"] as const).find((s) => s === sp.status);

  const [currency, settings, categories] = await Promise.all([getCurrency(), getCashSettings(db), db.expenseCategory.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } })]);
  const money = (v: Prisma.Decimal | string | number) => formatMoney(v, currency);

  const mine: Prisma.ExpenseWhereInput = seeAll ? {} : { requestedById: user.id };
  const expenseDate: Prisma.DateTimeFilter = {};
  if (isDate(sp.from)) expenseDate.gte = new Date(`${sp.from}T00:00:00Z`);
  if (isDate(sp.to)) expenseDate.lte = new Date(`${sp.to}T00:00:00Z`);
  // every filter except the status (the status pills show how many each has under the other filters)
  const base: Prisma.ExpenseWhereInput = {
    ...mine,
    ...(sp.category ? { categoryId: sp.category } : {}),
    ...(Object.keys(expenseDate).length ? { expenseDate } : {}),
    ...(q ? { OR: [{ description: { contains: q, mode: "insensitive" } }, { expenseNo: { contains: q, mode: "insensitive" } }, { category: { name: { contains: q, mode: "insensitive" } } }, { requestedBy: { name: { contains: q, mode: "insensitive" } } }] } : {}),
  };
  const where: Prisma.ExpenseWhereInput = { ...base, ...(status ? { status } : {}) };
  const include = { category: { select: { name: true } }, requestedBy: { select: { name: true } }, cashAccount: { select: { name: true, accountNumber: true } } } as const;

  const [rows, total, statusCounts, spentToday, spentYesterday, spentMonth, pendingAgg, pendingRows] = await Promise.all([
    db.expense.findMany({ where, orderBy: [{ expenseDate: "desc" }, { requestedAt: "desc" }, { id: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include }),
    db.expense.count({ where }),
    db.expense.groupBy({ by: ["status"], where: base, _count: true }),
    db.expense.aggregate({ where: { ...mine, status: "APPROVED", expenseDate: new Date(`${today}T00:00:00Z`) }, _sum: { amount: true }, _count: true }),
    db.expense.aggregate({ where: { ...mine, status: "APPROVED", expenseDate: new Date(`${yesterday}T00:00:00Z`) }, _sum: { amount: true } }),
    db.expense.aggregate({ where: { ...mine, status: "APPROVED", expenseDate: { gte: new Date(`${monthStart}T00:00:00Z`) } }, _sum: { amount: true }, _count: true }),
    db.expense.aggregate({ where: { ...mine, status: "PENDING" }, _sum: { amount: true }, _count: true }),
    db.expense.findMany({ where: { ...mine, status: "PENDING" }, orderBy: { requestedAt: "asc" }, take: 12, include }),
  ]);

  // totals per day for the days shown (a day can run over two pages)
  const days = [...new Set(rows.map((r) => ymdOf(r.expenseDate)))];
  const dayRows = days.length ? await db.expense.groupBy({ by: ["expenseDate", "status"], where: { ...where, expenseDate: { in: days.map((d) => new Date(`${d}T00:00:00Z`)) } }, _sum: { amount: true }, _count: true }) : [];
  const perDay = new Map<string, { n: number; paid: Prisma.Decimal }>();
  for (const r of dayRows) {
    const key = ymdOf(r.expenseDate);
    const cur = perDay.get(key) ?? { n: 0, paid: new Prisma.Decimal(0) };
    cur.n += r._count;
    if (r.status === "APPROVED") cur.paid = cur.paid.plus(r._sum.amount ?? 0);
    perDay.set(key, cur);
  }

  const paidToday = new Prisma.Decimal(spentToday._sum.amount ?? 0);
  const paidYesterday = new Prisma.Decimal(spentYesterday._sum.amount ?? 0);
  const vsYesterday = paidYesterday.gt(0) ? Math.round(paidToday.minus(paidYesterday).div(paidYesterday).mul(100).toNumber()) : null;
  const pendingCount = pendingAgg._count;
  const pendingSum = new Prisma.Decimal(pendingAgg._sum.amount ?? 0);
  const countOf = (s?: ExpenseStatus) => statusCounts.filter((r) => !s || r.status === s).reduce((t, r) => t + r._count, 0);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(q || status || sp.category || sp.from || sp.to);
  const from1 = (page - 1) * PAGE_SIZE + 1;

  const link = (over: Partial<Search>) => {
    const m = { q: q || undefined, status, category: sp.category, from: sp.from, to: sp.to, ...over } as Record<string, string | undefined>;
    const qs = new URLSearchParams(Object.entries(m).filter(([, v]) => v) as [string, string][]).toString();
    return `/expenses${qs ? `?${qs}` : ""}`;
  };
  const periods = [
    { label: "Today", from: today, to: today },
    { label: "Yesterday", from: yesterday, to: yesterday },
    { label: "Last 7 days", from: weekStart, to: today },
    { label: "This month", from: monthStart, to: today },
  ];
  const activePeriod = periods.find((p) => p.from === sp.from && p.to === sp.to);
  const limitText = settings.expenseApprovalLimit.gt(0)
    ? `Up to ${formatMoney(settings.expenseApprovalLimit, currency)} is recorded straight away. Anything above needs the owner to approve it first.`
    : "Every expense needs the owner's approval before the money is paid out.";

  return (
    <>
      <PageHeader title="Expenses" description={seeAll ? "Everything the shop spent. Money leaves the account it was paid from." : "Money you spent for the shop. Record it here so the owner can see it and the day's cash adds up."} />

      {sp.recorded && (
        <div className="mb-4">
          {sp.state === "pending" ? (
            <Alert kind="info">
              <strong>{sp.recorded}</strong> was sent to the owner for approval. Do not pay it out of the till until it is approved.
            </Alert>
          ) : (
            <Alert kind="success">
              <strong>{sp.recorded}</strong> is recorded and taken from the account you chose.
            </Alert>
          )}
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard icon={TrendingDown} tone="navy" label="Spent today" value={money(paidToday)} hint={`${spentToday._count} expense${spentToday._count === 1 ? "" : "s"}${vsYesterday !== null ? ` · ${vsYesterday >= 0 ? "+" : ""}${vsYesterday}% vs yesterday` : paidYesterday.isZero() ? "" : ` · yesterday ${money(paidYesterday)}`}`} href={link({ from: today, to: today, status: "APPROVED", page: undefined })} />
        <KpiCard icon={CalendarDays} tone="blue" label="Spent this month" value={money(spentMonth._sum.amount ?? 0)} hint={`${spentMonth._count} expense${spentMonth._count === 1 ? "" : "s"} paid`} href={link({ from: monthStart, to: today, status: "APPROVED", page: undefined })} />
        <KpiCard icon={Clock} tone={pendingCount > 0 ? "yellow" : "slate"} label="Waiting for owner's OK" value={pendingCount} hint={pendingCount > 0 ? `${money(pendingSum)} not paid out yet` : "Nothing is waiting"} href={pendingCount > 0 ? link({ status: "PENDING", from: undefined, to: undefined, page: undefined }) : undefined} />
        <KpiCard icon={ReceiptText} tone="slate" label="All expenses" value={countOf()} hint={hasFilters ? "With these filters" : "Since the shop started"} />
      </div>

      {pendingCount > 0 && (
        <section className="card mb-5 overflow-hidden border-oil-400/60">
          <div className="border-b border-line bg-oil-soft/50 px-4 py-3 sm:px-5">
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <Clock size={17} /> {canApprove ? `${pendingCount} expense${pendingCount === 1 ? " needs" : "s need"} your OK` : `${pendingCount} expense${pendingCount === 1 ? " is" : "s are"} waiting for the owner's OK`}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {canApprove
                ? "The shop asked to spend this money, but it is more than staff may spend on their own. Nothing has left any account yet. Approve to pay it out of the account shown, or reject it with a reason."
                : "These are more than staff may spend on their own, so the owner has to say yes first. Nothing has left any account yet: do not pay them out of the till until they are approved."}
            </p>
          </div>
          <ul className={cn("grid gap-px bg-line", canApprove && "md:grid-cols-2")}>
            {pendingRows.map((e) => (
              <li key={e.id} className="bg-white px-4 py-3.5 sm:px-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">
                      <Link href={`/expenses/${e.id}`} className="text-navy-700 hover:underline">
                        {e.expenseNo}
                      </Link>{" "}
                      · {e.category.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {e.requestedBy.name} · {formatDateTime(e.requestedAt)} · from {e.cashAccount?.name ?? methodLabel(e.method)}
                    </p>
                  </div>
                  <span className="shrink-0 text-base font-bold tabular-nums text-slate-900">{money(e.amount)}</span>
                </div>
                <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">“{e.description}”</p>
                {canApprove && (
                  <div className="mt-3">
                    <ExpenseDecisionForm expenseId={e.id} action={decideExpenseAction} />
                  </div>
                )}
              </li>
            ))}
          </ul>
          {pendingCount > pendingRows.length && <p className="border-t border-line px-4 py-2.5 text-xs text-slate-500 sm:px-5">Showing the oldest {pendingRows.length}. Use the &ldquo;Waiting for owner&apos;s OK&rdquo; filter below to see them all.</p>}
        </section>
      )}

      {canRecord && (
        <details className="card group mb-5">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3.5 text-base font-semibold text-slate-900 sm:px-5">
            Record an expense
            <span className="text-sm font-normal text-slate-500 group-open:hidden">{limitText}</span>
          </summary>
          <div className="border-t border-line px-4 py-4 sm:px-5">
            {categories.length === 0 ? (
              <Alert kind="info">The owner has not set up expense categories yet (Settings → Expenses).</Alert>
            ) : (
              <ExpenseForm key={sp.recorded ?? "new"} action={recordExpenseAction} accounts={await listAccounts(db, await defaultLocationId(db))} categories={categories} today={today} submissionKey={randomUUID()} limitText={limitText} />
            )}
          </div>
        </details>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <nav className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="Status">
          {STATUS_PILLS.filter((p) => p.key === undefined || p.key === status || countOf(p.key) > 0).map((p) => {
            const active = status === p.key;
            return (
              <Link key={p.label} href={link({ status: p.key, page: undefined })} aria-current={active ? "page" : undefined} className={cn("inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition", active ? "border-navy-700 bg-navy-700 text-white" : "border-line bg-white text-slate-600 hover:border-navy-200 hover:text-slate-900")}>
                {p.label}
                <span className={cn("rounded-full px-1.5 text-xs font-semibold", active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600")}>{countOf(p.key)}</span>
              </Link>
            );
          })}
        </nav>
        <nav className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="Period">
          {periods.map((p) => {
            const active = activePeriod === p;
            return (
              <Link key={p.label} href={link({ from: p.from, to: p.to, page: undefined })} aria-current={active ? "page" : undefined} className={cn("inline-flex shrink-0 items-center rounded-full border px-3.5 py-1.5 text-sm font-medium transition", active ? "border-navy-700 bg-navy-700 text-white" : "border-line bg-white text-slate-600 hover:border-navy-200 hover:text-slate-900")}>
                {p.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <form method="get" action="/expenses" className="card card-pad mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.6fr_1.1fr_auto_auto_auto_auto]">
        {status && <input type="hidden" name="status" value={status} />}
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input name="q" defaultValue={q} placeholder="Expense no., description or person" className="input pl-9" aria-label="Search expenses" />
        </div>
        <select name="category" defaultValue={sp.category ?? ""} className="input" aria-label="Category">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input type="date" name="from" defaultValue={sp.from ?? ""} className="input" aria-label="From date" />
        <input type="date" name="to" defaultValue={sp.to ?? ""} className="input" aria-label="To date" />
        <button className="btn-primary" type="submit">
          Apply
        </button>
        {hasFilters ? (
          <Link href="/expenses" className="btn-secondary">
            Clear
          </Link>
        ) : (
          <span className="hidden lg:block" />
        )}
      </form>

      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon={<ReceiptText size={22} />} title={hasFilters ? "No expenses match your filters" : "No expenses yet"} description={hasFilters ? "Try another period or clear the filters." : "Expenses appear here as soon as they are recorded."} />
        ) : (
          <>
            <div className={cn("hidden border-b border-line px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 lg:grid lg:items-center lg:gap-x-4", COLS)} aria-hidden>
              <span>Expense</span>
              <span>What it was for</span>
              <span>By</span>
              <span>Paid from</span>
              <span className="text-right">Amount</span>
              <span>Status</span>
            </div>
            {days.map((d) => {
              const t = perDay.get(d);
              return (
                <section key={d} aria-label={dayTitle(d, today, yesterday)}>
                  <h2 className="flex items-center justify-between gap-3 border-b border-line bg-slate-50/90 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 sm:px-5">
                    <span>{dayTitle(d, today, yesterday)}</span>
                    <span className="normal-case tracking-normal">
                      {t?.n ?? 0} expense{(t?.n ?? 0) === 1 ? "" : "s"} · paid <span className="font-semibold text-slate-800">{money(t?.paid ?? 0)}</span>
                    </span>
                  </h2>
                  <ul>
                    {rows
                      .filter((r) => ymdOf(r.expenseDate) === d)
                      .map((e) => {
                        const waiting = e.status === "PENDING";
                        return (
                          <li key={e.id} className={cn("grid grid-cols-2 items-center gap-x-4 gap-y-2 border-b border-l-[3px] border-b-line/70 px-4 py-3 last:border-b-0 sm:px-5", COLS, waiting ? "border-l-oil-400" : "border-l-transparent")}>
                            <div className="min-w-0">
                              <Link href={`/expenses/${e.id}`} className="block truncate font-mono text-sm font-semibold text-navy-700 hover:underline">
                                {e.expenseNo}
                              </Link>
                              <span className="block truncate text-xs text-slate-500">{e.category.name}</span>
                            </div>
                            <div className="justify-self-end lg:hidden">
                              <ExpenseStatusBadge status={e.status} />
                            </div>
                            <div className="col-span-2 min-w-0 truncate text-sm text-slate-900 lg:col-span-1" title={e.description}>
                              {e.description}
                            </div>
                            <div className="col-span-2 min-w-0 truncate text-sm text-slate-600 lg:col-span-1">
                              <span className="text-xs text-slate-500 lg:hidden">By </span>
                              {e.requestedBy.name}
                            </div>
                            <div className="col-span-2 min-w-0 lg:col-span-1">
                              <span className="block truncate text-sm text-slate-800">{e.cashAccount?.name ?? methodLabel(e.method)}</span>
                              {e.cashAccount?.accountNumber && <span className="block truncate text-xs text-slate-500">{e.cashAccount.accountNumber}</span>}
                            </div>
                            <div className="flex items-center justify-between gap-2 lg:block lg:text-right">
                              <span className="text-xs text-slate-500 lg:hidden">Amount</span>
                              <span className={cn("text-sm font-bold tabular-nums", e.status === "APPROVED" ? "text-slate-900" : "text-slate-400")}>{e.status === "APPROVED" ? "− " : ""}{money(e.amount)}</span>
                            </div>
                            <div className="hidden lg:block">
                              <ExpenseStatusBadge status={e.status} />
                              {waiting && <span className="mt-0.5 block text-[11px] text-slate-500">Not paid out yet</span>}
                            </div>
                          </li>
                        );
                      })}
                  </ul>
                </section>
              );
            })}
            {pages > 1 && (
              <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm sm:px-5">
                <span className="text-slate-500">
                  {from1}–{Math.min(page * PAGE_SIZE, total)} of {total}
                </span>
                <span className="flex gap-2">
                  {page > 1 && (
                    <Link href={link({ page: String(page - 1) })} className="btn-secondary !px-3 !py-1.5">
                      <ChevronLeft size={15} /> Newer
                    </Link>
                  )}
                  {page < pages && (
                    <Link href={link({ page: String(page + 1) })} className="btn-secondary !px-3 !py-1.5">
                      Older <ChevronRight size={15} />
                    </Link>
                  )}
                </span>
              </div>
            )}
          </>
        )}
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <CheckCircle2 size={13} /> A paid expense cannot be edited or deleted. Only the owner can reverse it, with a reason.
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock size={13} /> Dates follow Tanzania time.
        </span>
      </p>
    </>
  );
}
