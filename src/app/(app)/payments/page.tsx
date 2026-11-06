import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, HandCoins, Search, TrendingUp, Wallet } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import KpiCard from "@/components/dashboard/KpiCard";
import { Prisma, type PaymentMethod, type PaymentSource } from "@/generated/prisma/client";
import { canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { listAccounts } from "@/lib/cash/ledger";
import { todayYmd } from "@/lib/dashboard/range";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { methodLabel } from "@/lib/sales/types";
import { getCurrency } from "@/lib/settings";
import { cn } from "@/lib/utils";

export const metadata = { title: "Income" };

const PAGE_SIZE = 30;
const TZ = "Africa/Dar_es_Salaam";
type Search = { q?: string; account?: string; method?: string; source?: string; from?: string; to?: string; page?: string };
const isDate = (s?: string) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));
const METHODS: PaymentMethod[] = ["CASH", "MOBILE_MONEY", "BANK"];
const SOURCES: PaymentSource[] = ["AT_SALE", "DEBT_COLLECTION"];
const D = Prisma.Decimal;
const dec = (v: Prisma.Decimal | string | number | null | undefined) => new D((v ?? 0).toString());
const shift = (ymd: string, days: number) => new Date(new Date(`${ymd}T12:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
const timeOf = (d: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(d);
const dayTitle = (key: string, today: string, yesterday: string) =>
  key === today ? "Today" : key === yesterday ? "Yesterday" : new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));

// Payment | customer | paid into | type | amount | received by
const COLS = "lg:grid-cols-[minmax(10.5rem,1.1fr)_minmax(0,1.4fr)_minmax(0,1.3fr)_8.5rem_8rem_minmax(0,1fr)]";

type Row = { id: string; paymentNo: string; receivedAt: Date; day: string; source: PaymentSource; method: PaymentMethod; amount: Prisma.Decimal | string; reference: string | null; customerName: string | null; receivedBy: string; accountName: string | null; accountNumber: string | null };

/**
 * Income: all the money received, as it arrives. Paid at the time of sale, or collected later on a credit invoice (never counted as a new
 * sale). Every payment shows the account it went into. Today's numbers on top, quick filters, then the payments grouped by day.
 */
export default async function IncomePage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  if (!canAny(user, ["payments.view"])) redirect("/forbidden");
  const sp = await searchParams;
  const currency = await getCurrency();
  const money = (v: Prisma.Decimal | string) => formatMoney(v, currency);
  const q = sp.q?.trim().slice(0, 80) ?? "";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const source = SOURCES.includes(sp.source as PaymentSource) ? (sp.source as PaymentSource) : undefined;
  const today = todayYmd();
  const yesterday = shift(today, -1);
  const weekStart = shift(today, -6);
  const monthStart = `${today.slice(0, 8)}01`;
  const prevMonthStart = (() => {
    const [y, m] = today.split("-").map(Number) as [number, number];
    return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
  })();

  const day = Prisma.sql`(p."receivedAt" AT TIME ZONE ${TZ})::date`;
  // the account a payment went into is the account of its cash ledger row
  const from = Prisma.sql`FROM "Payment" p
    LEFT JOIN "Customer" c ON c."id" = p."customerId"
    JOIN "User" u ON u."id" = p."receivedById"
    LEFT JOIN "CashTransaction" t ON t."referenceType" = 'Payment' AND t."referenceId" = p."id" AND t."type" IN ('SALE_PAYMENT', 'COLLECTION')
    LEFT JOIN "CashAccount" a ON a."id" = t."accountId"`;
  const base: Prisma.Sql[] = [];
  if (sp.account) base.push(Prisma.sql`t."accountId" = ${sp.account}`);
  else if (METHODS.includes(sp.method as PaymentMethod)) base.push(Prisma.sql`p."method" = ${sp.method}::"PaymentMethod"`);
  if (isDate(sp.from)) base.push(Prisma.sql`${day} >= ${sp.from}::date`);
  if (isDate(sp.to)) base.push(Prisma.sql`${day} <= ${sp.to}::date`);
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    base.push(Prisma.sql`(p."paymentNo" ILIKE ${like} OR p."reference" ILIKE ${like} OR c."name" ILIKE ${like})`);
  }
  const conds = [...base];
  if (source) conds.push(Prisma.sql`p."source" = ${source}::"PaymentSource"`);
  const whereOf = (cs: Prisma.Sql[]) => (cs.length ? Prisma.sql`WHERE ${Prisma.join(cs, " AND ")}` : Prisma.empty);

  const [kpi, sourceCounts, rows, sums, accounts] = await Promise.all([
    db.$queryRaw<{ t_n: bigint; t_sum: Prisma.Decimal | null; y_sum: Prisma.Decimal | null; w_n: bigint; w_sum: Prisma.Decimal | null; m_n: bigint; m_sum: Prisma.Decimal | null; pm_sum: Prisma.Decimal | null; d_n: bigint; d_sum: Prisma.Decimal | null }[]>`
      SELECT COUNT(*) FILTER (WHERE ${day} = ${today}::date) AS t_n,
             SUM(p."amount") FILTER (WHERE ${day} = ${today}::date) AS t_sum,
             SUM(p."amount") FILTER (WHERE ${day} = ${yesterday}::date) AS y_sum,
             COUNT(*) FILTER (WHERE ${day} >= ${weekStart}::date) AS w_n,
             SUM(p."amount") FILTER (WHERE ${day} >= ${weekStart}::date) AS w_sum,
             COUNT(*) FILTER (WHERE ${day} >= ${monthStart}::date) AS m_n,
             SUM(p."amount") FILTER (WHERE ${day} >= ${monthStart}::date) AS m_sum,
             SUM(p."amount") FILTER (WHERE ${day} >= ${prevMonthStart}::date AND ${day} < ${monthStart}::date) AS pm_sum,
             COUNT(*) FILTER (WHERE p."source" = 'DEBT_COLLECTION' AND ${day} >= ${monthStart}::date) AS d_n,
             SUM(p."amount") FILTER (WHERE p."source" = 'DEBT_COLLECTION' AND ${day} >= ${monthStart}::date) AS d_sum
        FROM "Payment" p`,
    db.$queryRaw<{ src: PaymentSource; n: bigint }[]>`SELECT p."source" AS src, COUNT(*) AS n ${from} ${whereOf(base)} GROUP BY 1`,
    db.$queryRaw<Row[]>`
      SELECT p."id", p."paymentNo", p."receivedAt", ${day}::text AS day, p."source", p."method", p."amount", p."reference",
             c."name" AS "customerName", u."name" AS "receivedBy", a."name" AS "accountName", a."accountNumber" AS "accountNumber"
        ${from} ${whereOf(conds)}
       ORDER BY p."receivedAt" DESC, p."id" DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
    db.$queryRaw<{ n: bigint; total: Prisma.Decimal | null }[]>`SELECT COUNT(*) AS n, SUM(p."amount") AS total ${from} ${whereOf(conds)}`,
    listAccounts(db),
  ]);

  // totals per day for the days shown (a day can run over two pages)
  const days = [...new Set(rows.map((r) => r.day))];
  const dayTotals = days.length
    ? await db.$queryRaw<{ day: string; n: bigint; total: Prisma.Decimal | null }[]>`
        SELECT ${day}::text AS day, COUNT(*) AS n, SUM(p."amount") AS total ${from} ${whereOf(conds)} AND ${day} IN (${Prisma.join(days.map((d) => Prisma.sql`${d}::date`))}) GROUP BY 1`
    : [];
  const perDay = new Map(dayTotals.map((d) => [d.day, d]));

  const n = (v: bigint | number | null | undefined) => Number(v ?? 0);
  const k = kpi[0];
  const todaySum = dec(k?.t_sum);
  const ySum = dec(k?.y_sum);
  const vsYesterday = ySum.gt(0) ? Math.round(todaySum.minus(ySum).div(ySum).mul(100).toNumber()) : null;
  const weekSum = dec(k?.w_sum);
  const monthSum = dec(k?.m_sum);
  const pmSum = dec(k?.pm_sum);
  const countOf = (s?: PaymentSource) => sourceCounts.filter((r) => !s || r.src === s).reduce((t, r) => t + n(r.n), 0);
  const total = n(sums[0]?.n);
  const totalSum = dec(sums[0]?.total);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(q || sp.account || sp.method || source || sp.from || sp.to);
  const from1 = (page - 1) * PAGE_SIZE + 1;

  const link = (over: Partial<Search>) => {
    const m = { q: q || undefined, account: sp.account, method: sp.method, source, from: sp.from, to: sp.to, ...over } as Record<string, string | undefined>;
    const qs = new URLSearchParams(Object.entries(m).filter(([, v]) => v) as [string, string][]).toString();
    return `/payments${qs ? `?${qs}` : ""}`;
  };
  const periods = [
    { label: "Today", from: today, to: today },
    { label: "Yesterday", from: yesterday, to: yesterday },
    { label: "Last 7 days", from: weekStart, to: today },
    { label: "This month", from: monthStart, to: today },
  ];
  const activePeriod = periods.find((p) => p.from === sp.from && p.to === sp.to);
  const pills = [
    { key: undefined, label: "All", count: countOf() },
    { key: "AT_SALE" as const, label: "Paid at sale", count: countOf("AT_SALE") },
    { key: "DEBT_COLLECTION" as const, label: "Debts collected", count: countOf("DEBT_COLLECTION") },
  ];

  return (
    <>
      <PageHeader title="Income" description="All the money received: paid at the time of sale, or collected later on a credit invoice (never counted as a new sale). Each payment shows the account it went into." />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard
          icon={Wallet}
          tone="navy"
          label="Received today"
          value={money(todaySum)}
          hint={`${n(k?.t_n)} payment${n(k?.t_n) === 1 ? "" : "s"}${vsYesterday !== null ? ` · ${vsYesterday >= 0 ? "+" : ""}${vsYesterday}% vs yesterday` : ySum.isZero() ? "" : ` · yesterday ${money(ySum)}`}`}
          href={link({ from: today, to: today, page: undefined })}
          active={sp.from === today && sp.to === today}
        />
        <KpiCard icon={CalendarDays} tone="blue" label="Last 7 days" value={money(weekSum)} hint={`${n(k?.w_n)} payment${n(k?.w_n) === 1 ? "" : "s"} · about ${money(weekSum.div(7).toDecimalPlaces(0))} a day`} href={link({ from: weekStart, to: today, page: undefined })} active={sp.from === weekStart && sp.to === today} />
        <KpiCard icon={TrendingUp} tone="green" label="This month" value={money(monthSum)} hint={`${n(k?.m_n)} payment${n(k?.m_n) === 1 ? "" : "s"}${pmSum.gt(0) ? ` · last month ${money(pmSum)}` : ""}`} href={link({ from: monthStart, to: today, page: undefined })} active={sp.from === monthStart && sp.to === today} />
        <KpiCard icon={HandCoins} tone="yellow" label="Debts collected this month" value={money(dec(k?.d_sum))} hint={`${n(k?.d_n)} payment${n(k?.d_n) === 1 ? "" : "s"} on credit invoices`} href={link({ source: "DEBT_COLLECTION", from: monthStart, to: today, page: undefined })} />
      </div>

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

      <form method="get" action="/payments" className="card card-pad mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.6fr_1.1fr_auto_auto_auto_auto]">
        {source && <input type="hidden" name="source" value={source} />}
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
        <input type="date" name="from" defaultValue={sp.from ?? ""} className="input" aria-label="From date" />
        <input type="date" name="to" defaultValue={sp.to ?? ""} className="input" aria-label="To date" />
        <button className="btn-primary" type="submit">
          Apply
        </button>
        {hasFilters ? (
          <Link href="/payments" className="btn-secondary">
            Clear
          </Link>
        ) : (
          <span className="hidden lg:block" />
        )}
      </form>

      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon={<Wallet size={22} />} title={hasFilters ? "No payments match your filters" : "No income yet"} description={hasFilters ? "Try another period or clear the filters." : "Payments appear here when a sale is paid or a customer settles a debt."} />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-line bg-slate-50/60 px-4 py-2.5 text-sm sm:px-5">
              <span className="text-slate-600">
                {total} payment{total === 1 ? "" : "s"}
                {activePeriod ? ` · ${activePeriod.label.toLowerCase()}` : ""}
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
    </>
  );
}
