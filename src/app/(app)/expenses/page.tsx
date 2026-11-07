import Link from "next/link";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { CheckCircle2, ChevronLeft, ChevronRight, Clock, ReceiptText, Search, Tag, Wallet } from "lucide-react";
import { Alert, EmptyState, PageHeader } from "@/components/ui";
import { ExpenseDecisionForm, RecordExpenseButton } from "@/components/cash/ExpenseForms";
import { ExpenseStatusBadge } from "@/components/cash/Display";
import KpiCard from "@/components/dashboard/KpiCard";
import { Prisma, type ExpenseStatus } from "@/generated/prisma/client";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { businessDay, defaultLocationId, listAccounts } from "@/lib/cash/ledger";
import { getCashSettings } from "@/lib/cash/settings";
import { getMoneySummary } from "@/lib/cash/summary";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { methodLabel } from "@/lib/sales/types";
import { getCurrency } from "@/lib/settings";
import { cn, formatDateTime } from "@/lib/utils";
import { decideExpenseAction, recordExpenseAction } from "./actions";

export const metadata = { title: "Expenses" };

const PAGE_SIZE = 30;
const DOTS = ["bg-brand-red", "bg-oil-400", "bg-navy-400", "bg-emerald-500", "bg-violet-500", "bg-sky-500", "bg-orange-400", "bg-slate-400"] as const;
type Search = { status?: string; category?: string; q?: string; from?: string; to?: string; all?: string; page?: string; recorded?: string; state?: string };
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
  const yearStart = `${today.slice(0, 5)}01-01`;
  // the period: this month unless another is chosen ("All time" turns it off)
  const allTime = sp.all === "1";
  const from = isDate(sp.from) ? sp.from! : allTime || isDate(sp.to) ? undefined : monthStart;
  const to = isDate(sp.to) ? sp.to! : allTime || isDate(sp.from) ? undefined : today;
  const q = sp.q?.trim().slice(0, 80) ?? "";
  const status = (["PENDING", "APPROVED", "REJECTED", "REVERSED"] as const).find((s) => s === sp.status);

  const [currency, settings, categories] = await Promise.all([getCurrency(), getCashSettings(db), db.expenseCategory.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } })]);
  const money = (v: Prisma.Decimal | string | number) => formatMoney(v, currency);

  const mine: Prisma.ExpenseWhereInput = seeAll ? {} : { requestedById: user.id };
  const expenseDate: Prisma.DateTimeFilter = {};
  if (from) expenseDate.gte = new Date(`${from}T00:00:00Z`);
  if (to) expenseDate.lte = new Date(`${to}T00:00:00Z`);
  // every filter except the status (the status pills show how many each has under the other filters)
  const base: Prisma.ExpenseWhereInput = {
    ...mine,
    ...(sp.category ? { categoryId: sp.category } : {}),
    ...(Object.keys(expenseDate).length ? { expenseDate } : {}),
    ...(q ? { OR: [{ description: { contains: q, mode: "insensitive" } }, { expenseNo: { contains: q, mode: "insensitive" } }, { category: { name: { contains: q, mode: "insensitive" } } }, { requestedBy: { name: { contains: q, mode: "insensitive" } } }] } : {}),
  };
  const where: Prisma.ExpenseWhereInput = { ...base, ...(status ? { status } : {}) };
  const include = { category: { select: { name: true } }, requestedBy: { select: { name: true } }, cashAccount: { select: { name: true, accountNumber: true } } } as const;

  const locationId = await defaultLocationId(db);
  // the same filters as the list, but not the category, so every category card shows its own total
  const forCards: Prisma.ExpenseWhereInput = { ...mine, ...(Object.keys(expenseDate).length ? { expenseDate } : {}) };

  const [rows, total, statusCounts, byCategory, pendingAgg, pendingRows, summary] = await Promise.all([
    db.expense.findMany({ where, orderBy: [{ expenseDate: "desc" }, { requestedAt: "desc" }, { id: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include }),
    db.expense.count({ where }),
    db.expense.groupBy({ by: ["status"], where: base, _count: true }),
    db.expense.groupBy({ by: ["categoryId"], where: { ...forCards, status: "APPROVED" }, _sum: { amount: true }, _count: true }),
    db.expense.aggregate({ where: { ...mine, status: "PENDING" }, _sum: { amount: true }, _count: true }),
    db.expense.findMany({ where: { ...mine, status: "PENDING" }, orderBy: { requestedAt: "asc" }, take: 12, include }),
    // what the owner took out in the same period (withdrawals are not expenses, but they leave the accounts just the same)
    can(user, "cash.view") ? getMoneySummary(db, locationId, { from, to }) : Promise.resolve(null),
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

  const spentTotal = byCategory.reduce((t, r) => t.plus(r._sum.amount ?? 0), new Prisma.Decimal(0));
  const spentCount = byCategory.reduce((t, r) => t + r._count, 0);
  const spread = categories
    .map((c) => ({ id: c.id, name: c.name, n: byCategory.find((x) => x.categoryId === c.id)?._count ?? 0, value: new Prisma.Decimal(byCategory.find((x) => x.categoryId === c.id)?._sum.amount ?? 0) }))
    .filter((c) => c.value.gt(0))
    .sort((a, b) => b.value.comparedTo(a.value));
  const biggest = spread[0];
  const pendingCount = pendingAgg._count;
  const pendingSum = new Prisma.Decimal(pendingAgg._sum.amount ?? 0);
  const countOf = (s?: ExpenseStatus) => statusCounts.filter((r) => !s || r.status === s).reduce((t, r) => t + r._count, 0);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(q || status || sp.category);
  const from1 = (page - 1) * PAGE_SIZE + 1;

  const link = (over: Partial<Search>) => {
    const m = { q: q || undefined, status, category: sp.category, from: sp.from, to: sp.to, all: sp.all, ...over } as Record<string, string | undefined>;
    const qs = new URLSearchParams(Object.entries(m).filter(([, v]) => v) as [string, string][]).toString();
    return `/expenses${qs ? `?${qs}` : ""}`;
  };
  const periods = [
    { label: "All time", from: undefined, to: undefined, all: "1" },
    { label: "Today", from: today, to: today },
    { label: "Yesterday", from: yesterday, to: yesterday },
    { label: "This week", from: weekStart, to: today },
    { label: "This month", from: monthStart, to: today },
    { label: "This year", from: yearStart, to: today },
  ] as { label: string; from?: string; to?: string; all?: string }[];
  const activePeriod = periods.find((p) => (p.all ? allTime && !sp.from && !sp.to : !allTime && p.from === from && p.to === to));
  const limitText = settings.expenseApprovalLimit.gt(0)
    ? `Up to ${formatMoney(settings.expenseApprovalLimit, currency)} is recorded straight away. Anything above needs the owner to approve it first.`
    : "An expense is recorded and paid straight away.";

  return (
    <>
      <PageHeader
        title="Expenses"
        description={seeAll ? "Everything the shop spent." : "Money you spent for the shop."}
        actions={canRecord ? <RecordExpenseButton key={sp.recorded ?? "new"} action={recordExpenseAction} accounts={await listAccounts(db, await defaultLocationId(db))} categories={categories} today={today} submissionKey={randomUUID()} limitText={limitText} /> : undefined}
      />

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

      <div className="mb-5 grid gap-3 sm:gap-4 [grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))]">
        <KpiCard icon={ReceiptText} tone="red" label="Spent on expenses" value={money(spentTotal)} hint={`${spentCount} paid expense${spentCount === 1 ? "" : "s"}${activePeriod ? ` · ${activePeriod.label.toLowerCase()}` : ""}`} />
        {biggest && <KpiCard icon={Tag} tone="navy" label="Biggest category" value={money(biggest.value)} hint={`${biggest.name} · ${spentTotal.gt(0) ? Math.round(biggest.value.div(spentTotal).mul(100).toNumber()) : 0}% of the spending`} href={link({ category: biggest.id, page: undefined })} />}
        {summary && <KpiCard icon={Wallet} tone="slate" label="Taken out by the owner" value={money(summary.withdrawals)} hint="Withdrawals, shown in the ledger" href={`/ledger?type=WITHDRAWAL${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`} />}
        {pendingCount > 0 && <KpiCard icon={Clock} tone="yellow" label="Waiting for owner's OK" value={money(pendingSum)} hint={`${pendingCount} expense${pendingCount === 1 ? "" : "s"} · not paid out yet`} href={link({ status: "PENDING", page: undefined })} active={status === "PENDING"} />}
      </div>

      {spread.length > 0 && (
        <section className="card mb-5 px-4 py-4 sm:px-5" aria-label="Where the money went">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">Where the money went</h2>
            <p className="text-xs text-slate-500">Press a category to see its expenses</p>
          </div>
          <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-100" role="img" aria-label="Share of the spending by category">
            {spread.map((c, i) => (
              <Link key={c.id} href={link({ category: c.id, page: undefined })} title={`${c.name}: ${money(c.value)}`} className={cn("h-full transition hover:opacity-80", DOTS[i % DOTS.length])} style={{ width: `${Math.max(spentTotal.gt(0) ? c.value.div(spentTotal).mul(100).toNumber() : 0, 1.5)}%` }} />
            ))}
          </div>
          <ul className="mt-3 grid gap-x-4 gap-y-2 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]">
            {spread.map((c, i) => (
              <li key={c.id}>
                <Link href={link({ category: sp.category === c.id ? undefined : c.id, page: undefined })} className={cn("flex items-start gap-2 rounded-lg px-1.5 py-1 transition hover:bg-slate-50", sp.category === c.id && "bg-slate-100")}>
                  <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", DOTS[i % DOTS.length])} />
                  <span className="min-w-0">
                    <span className="block truncate text-xs text-slate-500">{c.name} · {c.n}</span>
                    <span className="block text-sm font-semibold text-slate-900">{money(c.value)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

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
        <nav className="-mx-1 flex flex-wrap gap-1.5 px-1 pb-1" aria-label="Period">
          {periods.map((p) => (
            <Link key={p.label} href={link({ from: p.from, to: p.to, all: p.all, page: undefined })} aria-current={activePeriod === p ? "page" : undefined} className={cn("inline-flex shrink-0 items-center rounded-full border px-3.5 py-1.5 text-sm font-medium transition", activePeriod === p ? "border-navy-700 bg-navy-700 text-white" : "border-line bg-white text-slate-600 hover:border-navy-200 hover:text-slate-900")}>
              {p.label}
            </Link>
          ))}
        </nav>
      </div>

      <form method="get" action="/expenses" className="card card-pad mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.6fr_1.1fr_auto_auto]">
        {status && <input type="hidden" name="status" value={status} />}
        {sp.from && <input type="hidden" name="from" value={sp.from} />}
        {sp.to && <input type="hidden" name="to" value={sp.to} />}
        {allTime && <input type="hidden" name="all" value="1" />}
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
        <button className="btn-primary" type="submit">
          Apply
        </button>
        {hasFilters ? (
          <Link href={link({ q: undefined, category: undefined, status: undefined, page: undefined })} className="btn-secondary">
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
