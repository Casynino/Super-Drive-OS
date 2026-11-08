import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, HandCoins, ReceiptText, Search, TrendingUp, Wallet } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import KpiCard from "@/components/dashboard/KpiCard";
import KpiStrip from "@/components/dashboard/KpiStrip";
import { Prisma, type PaymentMethod, type PaymentSource } from "@/generated/prisma/client";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { defaultLocationId, listAccounts } from "@/lib/cash/ledger";
import { getMoneySummary } from "@/lib/cash/summary";
import { getProfit } from "@/lib/reports/period";
import { todayYmd } from "@/lib/dashboard/range";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { owedSql } from "@/lib/sales/owed";
import { methodLabel } from "@/lib/sales/types";
import { getCurrency } from "@/lib/settings";
import { cn } from "@/lib/utils";

export const metadata = { title: "Income" };

const PAGE_SIZE = 30;
const TZ = "Africa/Dar_es_Salaam";
type Search = { q?: string; account?: string; method?: string; source?: string; from?: string; to?: string; all?: string; page?: string };
const isDate = (s?: string) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));
const METHODS: PaymentMethod[] = ["CASH", "MOBILE_MONEY", "BANK"];
const SOURCES: PaymentSource[] = ["AT_SALE", "DEBT_COLLECTION"];
const D = Prisma.Decimal;
const DOTS = ["bg-navy-400", "bg-oil-400", "bg-emerald-500", "bg-violet-500", "bg-sky-500", "bg-orange-400"] as const;
const dec = (v: Prisma.Decimal | string | number | null | undefined) => new D((v ?? 0).toString());
const shift = (ymd: string, days: number) => new Date(new Date(`${ymd}T12:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
const timeOf = (d: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(d);
const dayTitle = (key: string, today: string, yesterday: string) =>
  key === today ? "Today" : key === yesterday ? "Yesterday" : new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));

// Payment | customer | paid into | type | amount | received by
const COLS = "lg:grid-cols-[minmax(10.5rem,1.1fr)_minmax(0,1.4fr)_minmax(0,1.3fr)_8.5rem_8rem_minmax(0,1fr)]";

type Row = { id: string; paymentNo: string; receivedAt: Date; day: string; source: PaymentSource; method: PaymentMethod; amount: Prisma.Decimal | string; reference: string | null; customerName: string | null; receivedBy: string; accountName: string | null; accountNumber: string | null };

/**
 * Income: the money received, and where it went. The headline is income after refunds, taken from the same cash ledger as the
 * General ledger, so it always agrees with it: income only goes down by refunds, and what is LEFT goes down by expenses,
 * supplier payments and what the owner takes out. Below: every payment, grouped by day, with the account it went into.
 */
export default async function IncomePage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  if (!canAny(user, ["payments.view"])) redirect("/forbidden");
  const sp = await searchParams;
  const currency = await getCurrency();
  const money = (v: Prisma.Decimal | string) => formatMoney(v, currency);
  const locationId = await defaultLocationId(db);
  const q = sp.q?.trim().slice(0, 80) ?? "";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const source = SOURCES.includes(sp.source as PaymentSource) ? (sp.source as PaymentSource) : undefined;
  const today = todayYmd();
  const yesterday = shift(today, -1);
  const weekStart = shift(today, -6);
  const monthStart = `${today.slice(0, 8)}01`;
  const yearStart = `${today.slice(0, 5)}01-01`;
  const seeMoney = can(user, "cash.view"); // where the money went (expenses, suppliers, owner) is for the owner side
  // the period: this month unless another is chosen ("All time" turns it off)
  const allTime = sp.all === "1";
  const from = isDate(sp.from) ? sp.from! : allTime || isDate(sp.to) ? undefined : monthStart;
  const to = isDate(sp.to) ? sp.to! : allTime || isDate(sp.from) ? undefined : today;

  const day = Prisma.sql`(p."receivedAt" AT TIME ZONE ${TZ})::date`;
  // the account a payment went into is the account of its cash ledger row
  const fromSql = Prisma.sql`FROM "Payment" p
    LEFT JOIN "Customer" c ON c."id" = p."customerId"
    JOIN "User" u ON u."id" = p."receivedById"
    LEFT JOIN "CashTransaction" t ON t."referenceType" = 'Payment' AND t."referenceId" = p."id" AND t."type" IN ('SALE_PAYMENT', 'COLLECTION')
    LEFT JOIN "CashAccount" a ON a."id" = t."accountId"`;
  const base: Prisma.Sql[] = [];
  if (sp.account) base.push(Prisma.sql`t."accountId" = ${sp.account}`);
  else if (METHODS.includes(sp.method as PaymentMethod)) base.push(Prisma.sql`p."method" = ${sp.method}::"PaymentMethod"`);
  if (from) base.push(Prisma.sql`${day} >= ${from}::date`);
  if (to) base.push(Prisma.sql`${day} <= ${to}::date`);
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    base.push(Prisma.sql`(p."paymentNo" ILIKE ${like} OR p."reference" ILIKE ${like} OR c."name" ILIKE ${like})`);
  }
  const conds = [...base];
  if (source) conds.push(Prisma.sql`p."source" = ${source}::"PaymentSource"`);
  const whereOf = (cs: Prisma.Sql[]) => (cs.length ? Prisma.sql`WHERE ${Prisma.join(cs, " AND ")}` : Prisma.empty);
  const owed = owedSql("s");

  const [summary, sourceCounts, rows, sums, accounts, toCollect] = await Promise.all([
    getMoneySummary(db, locationId, { from, to }),
    db.$queryRaw<{ src: PaymentSource; n: bigint }[]>`SELECT p."source" AS src, COUNT(*) AS n ${fromSql} ${whereOf(base)} GROUP BY 1`,
    db.$queryRaw<Row[]>`
      SELECT p."id", p."paymentNo", p."receivedAt", ${day}::text AS day, p."source", p."method", p."amount", p."reference",
             c."name" AS "customerName", u."name" AS "receivedBy", a."name" AS "accountName", a."accountNumber" AS "accountNumber"
        ${fromSql} ${whereOf(conds)}
       ORDER BY p."receivedAt" DESC, p."id" DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
    db.$queryRaw<{ n: bigint; total: Prisma.Decimal | null }[]>`SELECT COUNT(*) AS n, SUM(p."amount") AS total ${fromSql} ${whereOf(conds)}`,
    listAccounts(db),
    // billed and not paid yet: it becomes income only when the money is really received
    db.$queryRaw<{ owed: Prisma.Decimal | null; n: bigint }[]>`SELECT SUM(${owed}) AS owed, COUNT(*) AS n FROM "Sale" s WHERE s."status" = 'COMPLETED' AND ${owed} > 0`,
  ]);

  // totals per day for the days shown (a day can run over two pages)
  const days = [...new Set(rows.map((r) => r.day))];
  const dayTotals = days.length
    ? await db.$queryRaw<{ day: string; n: bigint; total: Prisma.Decimal | null }[]>`
        SELECT ${day}::text AS day, COUNT(*) AS n, SUM(p."amount") AS total ${fromSql} ${whereOf(conds)} AND ${day} IN (${Prisma.join(days.map((d) => Prisma.sql`${d}::date`))}) GROUP BY 1`
    : [];
  const perDay = new Map(dayTotals.map((d) => [d.day, d]));

  const n = (v: bigint | number | null | undefined) => Number(v ?? 0);
  const countOf = (s?: PaymentSource) => sourceCounts.filter((r) => !s || r.src === s).reduce((t, r) => t + n(r.n), 0);
  const total = n(sums[0]?.n);
  const totalSum = dec(sums[0]?.total);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(q || sp.account || sp.method || source);
  const from1 = (page - 1) * PAGE_SIZE + 1;
  const seeDebts = can(user, "credit.view"); // who owes what is for the people who may see credit

  const link = (over: Partial<Search>) => {
    const m = { q: q || undefined, account: sp.account, method: sp.method, source, from: sp.from, to: sp.to, all: sp.all, ...over } as Record<string, string | undefined>;
    const qs = new URLSearchParams(Object.entries(m).filter(([, v]) => v) as [string, string][]).toString();
    return `/payments${qs ? `?${qs}` : ""}`;
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
  const pills = [
    { key: undefined, label: "All", count: countOf() },
    { key: "AT_SALE" as const, label: "Paid at sale", count: countOf("AT_SALE") },
    { key: "DEBT_COLLECTION" as const, label: "Debts collected", count: countOf("DEBT_COLLECTION") },
  ];
  const periodLabel = activePeriod?.label.toLowerCase() ?? "this period";
  const seeProfit = can(user, "dashboard.financials") || can(user, "reports.financial");
  const profit = seeProfit ? await getProfit(db, summary.expenses, from, to) : null;
  const landed = summary.byAccount.filter((a) => a.income.gt(0));
  const landedTotal = landed.reduce((t, a) => t.plus(a.income), new D(0));

  return (
    <>
      <PageHeader title="Income" description="Every payment received and the account it went into." />

      <KpiStrip className="mb-5">
        <KpiCard icon={Wallet} tone="navy" label="Income received" value={money(summary.income)} hint={`${summary.payments} payment${summary.payments === 1 ? "" : "s"} · ${periodLabel}${summary.refunds.gt(0) ? ` · ${money(summary.refunds)} paid back is taken off` : ""}`} />
        {seeMoney && <KpiCard icon={ReceiptText} tone="red" label="Spent" value={money(summary.spent)} badge={summary.income.gt(0) ? `${summary.spent.div(summary.income).mul(100).toFixed(0)}% of income` : undefined} hint={`Expenses ${money(summary.expenses)} · suppliers ${money(summary.suppliers)} · owner ${money(summary.withdrawals)}`} href={`/ledger?dir=out${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`} />}
        {seeMoney && <KpiCard icon={TrendingUp} tone={summary.left.lt(0) ? "red" : "green"} label="What is left" value={money(summary.left)} hint={summary.corrections.isZero() ? "Income − everything spent" : `Income − spent, with ${money(summary.corrections)} of counting corrections`} href={`/ledger${from ? `?from=${from}${to ? `&to=${to}` : ""}` : ""}`} />}
        {profit && <KpiCard icon={TrendingUp} tone={profit.net.lt(0) ? "red" : "green"} label="Profit" value={money(profit.net)} badge={`${profit.marginPct.toFixed(1)}% of sales`} hint={`Sales profit ${money(profit.gross)} − expenses ${money(summary.expenses)}`} />}
        {seeDebts && <KpiCard icon={HandCoins} tone="yellow" label="Still to collect" value={money(dec(toCollect[0]?.owed))} hint={`${n(toCollect[0]?.n)} invoice${n(toCollect[0]?.n) === 1 ? "" : "s"} billed, not paid yet`} href="/credit" />}
      </KpiStrip>

      {landed.length > 0 && (
        <section className="card mb-5 px-4 py-4 sm:px-5" aria-label="Where the income landed">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">Where the income landed</h2>
            <p className="text-xs text-slate-500">Press an account to see its payments</p>
          </div>
          <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-100" role="img" aria-label="Share of the income by account">
            {landed.map((a, i) => (
              <Link key={a.id} href={link({ account: a.id, page: undefined })} title={`${a.name}: ${money(a.income)}`} className={cn("h-full transition hover:opacity-80", DOTS[i % DOTS.length])} style={{ width: `${Math.max(a.income.div(landedTotal).mul(100).toNumber(), 1.5)}%` }} />
            ))}
          </div>
          <ul className="mt-3 grid gap-x-4 gap-y-2 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]">
            {landed.map((a, i) => (
              <li key={a.id}>
                <Link href={link({ account: a.id, page: undefined })} className={cn("flex items-start gap-2 rounded-lg px-1.5 py-1 transition hover:bg-slate-50", sp.account === a.id && "bg-slate-100")}>
                  <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", DOTS[i % DOTS.length])} />
                  <span className="min-w-0">
                    <span className="block truncate text-xs text-slate-500">{a.name}</span>
                    <span className="block text-sm font-semibold text-slate-900">{money(a.income)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div>
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <nav className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="Type of payment">
            {pills.map((p) => {
              const active = source === p.key;
              return (
                <Link key={p.label} href={link({ source: p.key, page: undefined })} aria-current={active ? "page" : undefined} className={cn("inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition", active ? "border-navy-700 bg-navy-700 text-white" : "border-line bg-white text-slate-600 hover:border-navy-200 hover:text-slate-900")}>
                  {p.label}
                  <span className={cn("rounded-full px-1.5 text-xs font-semibold", active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600")}>{p.count}</span>
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

          <form method="get" action="/payments" className="card card-pad mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.6fr_1.1fr_auto_auto]">
            {source && <input type="hidden" name="source" value={source} />}
            {sp.from && <input type="hidden" name="from" value={sp.from} />}
            {sp.to && <input type="hidden" name="to" value={sp.to} />}
            {allTime && <input type="hidden" name="all" value="1" />}
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input name="q" defaultValue={q} placeholder="Payment no., customer or reference" className="input pl-9" aria-label="Search payments" />
            </div>
            <select name="account" defaultValue={sp.account ?? ""} className="input" aria-label="Account">
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.accountNumber ? ` · ${a.accountNumber}` : ""}
                </option>
              ))}
            </select>
            <button className="btn-primary" type="submit">
              Apply
            </button>
            {hasFilters ? (
              <Link href={link({ q: undefined, account: undefined, method: undefined, source: undefined, page: undefined })} className="btn-secondary">
                Clear
              </Link>
            ) : (
              <span className="hidden lg:block" />
            )}
          </form>

          <div className="card overflow-hidden">
            {rows.length === 0 ? (
              <EmptyState icon={<Wallet size={22} />} title={hasFilters ? "No payments match your filters" : "No income in this period"} description={hasFilters ? "Try another period or clear the filters." : "Payments appear here when a sale is paid or a customer settles a debt."} />
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-line bg-slate-50/60 px-4 py-2.5 text-sm sm:px-5">
                  <span className="text-slate-600">
                    {total} payment{total === 1 ? "" : "s"} · {periodLabel}
                  </span>
                  <span className="text-slate-600">
                    Received <span className="font-semibold text-emerald-700">{money(totalSum)}</span>
                  </span>
                </div>
                <div className={cn("hidden border-b border-line px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 lg:grid lg:items-center lg:gap-x-4", COLS)} aria-hidden>
                  <span>Payment</span>
                  <span>Customer</span>
                  <span>Paid into</span>
                  <span>Type</span>
                  <span className="text-right">Amount</span>
                  <span>Received by</span>
                </div>
                {days.map((d) => {
                  const t = perDay.get(d);
                  return (
                    <section key={d} aria-label={dayTitle(d, today, yesterday)}>
                      <h2 className="flex items-center justify-between gap-3 border-b border-line bg-slate-50/90 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 sm:px-5">
                        <span>{dayTitle(d, today, yesterday)}</span>
                        <span className="normal-case tracking-normal">
                          {n(t?.n)} payment{n(t?.n) === 1 ? "" : "s"} · <span className="font-semibold text-slate-800">{money(dec(t?.total))}</span>
                        </span>
                      </h2>
                      <ul>
                        {rows
                          .filter((r) => r.day === d)
                          .map((r) => (
                            <li key={r.id} className={cn("grid grid-cols-2 items-center gap-x-4 gap-y-2 border-b border-line/70 px-4 py-3 last:border-b-0 sm:px-5", COLS)}>
                              <div className="min-w-0">
                                <Link href={`/payments/${r.id}`} className="block truncate font-mono text-sm font-semibold text-navy-700 hover:underline">
                                  {r.paymentNo}
                                </Link>
                                <span className="block text-xs text-slate-500">
                                  {timeOf(r.receivedAt)}
                                  {r.reference ? ` · ref ${r.reference}` : ""}
                                </span>
                              </div>
                              <div className="justify-self-end lg:hidden">
                                <span className={r.source === "AT_SALE" ? "badge-blue" : "badge-green"}>{r.source === "AT_SALE" ? "Paid at sale" : "Debt collected"}</span>
                              </div>
                              <div className="col-span-2 min-w-0 truncate text-sm font-medium text-slate-900 lg:col-span-1">{r.customerName ?? <span className="font-normal text-slate-400">Walk-in</span>}</div>
                              <div className="col-span-2 min-w-0 lg:col-span-1">
                                <span className="block truncate text-sm text-slate-800">{r.accountName ?? methodLabel(r.method)}</span>
                                <span className="block truncate text-xs text-slate-500">
                                  {methodLabel(r.method)}
                                  {r.accountNumber ? ` · ${r.accountNumber}` : ""}
                                </span>
                              </div>
                              <div className="hidden lg:block">
                                <span className={r.source === "AT_SALE" ? "badge-blue" : "badge-green"}>{r.source === "AT_SALE" ? "Paid at sale" : "Debt collected"}</span>
                              </div>
                              <div className="flex items-center justify-between gap-2 lg:block lg:text-right">
                                <span className="text-xs text-slate-500 lg:hidden">Amount</span>
                                <span className="text-sm font-bold tabular-nums text-emerald-700">+ {money(r.amount)}</span>
                              </div>
                              <div className="col-span-2 min-w-0 truncate text-sm text-slate-600 lg:col-span-1">
                                <span className="text-xs text-slate-500 lg:hidden">Received by </span>
                                {r.receivedBy}
                              </div>
                            </li>
                          ))}
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
        </div>

      </div>
    </>
  );
}
