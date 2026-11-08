import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Receipt, Search, TrendingUp, Wallet } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import KpiCard from "@/components/dashboard/KpiCard";
import KpiStrip from "@/components/dashboard/KpiStrip";
import { Prisma } from "@/generated/prisma/client";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { todayYmd } from "@/lib/dashboard/range";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { owedSql } from "@/lib/sales/owed";
import { getCurrency } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { SaleStatusBadge } from "./StatusBadge";

export const metadata = { title: "Sales history" };

const PAGE_SIZE = 30;
const TZ = "Africa/Dar_es_Salaam";
type Search = { q?: string; customer?: string; status?: string; seller?: string; from?: string; to?: string; page?: string };
const isDate = (s?: string) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));
const D = Prisma.Decimal;
const dec = (v: Prisma.Decimal | string | number | null | undefined) => new D((v ?? 0).toString());
const shift = (ymd: string, days: number) => new Date(new Date(`${ymd}T12:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
const timeOf = (d: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(d);
const dayTitle = (key: string, today: string, yesterday: string) =>
  key === today ? "Today" : key === yesterday ? "Yesterday" : new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));

const STATUSES = ["paid", "partial", "unpaid", "cancelled"] as const;
type StatusKey = (typeof STATUSES)[number];
const PAY: Record<Exclude<StatusKey, "cancelled">, string> = { paid: "PAID", partial: "PARTIALLY_PAID", unpaid: "UNPAID" };

// Invoice | customer | sold by | total | paid | balance | status
const COLS_ALL = "lg:grid-cols-[minmax(10.5rem,1.1fr)_minmax(0,1.5fr)_minmax(0,1fr)_7rem_7rem_7rem_6.5rem]";
const COLS_OWN = "lg:grid-cols-[minmax(10.5rem,1.2fr)_minmax(0,1.8fr)_7rem_7rem_7rem_6.5rem]";

type Row = {
  id: string;
  saleNo: string;
  createdAt: Date;
  day: string;
  status: "COMPLETED" | "CANCELLED";
  paymentStatus: "PAID" | "PARTIALLY_PAID" | "UNPAID";
  channel: "SHOP" | "RESELLER";
  total: Prisma.Decimal | string;
  returnedTotal: Prisma.Decimal | string;
  amountPaid: Prisma.Decimal | string;
  refundedTotal: Prisma.Decimal | string;
  owed: Prisma.Decimal | string;
  customerName: string | null;
  sellerName: string;
  items: bigint;
};

/**
 * Sales history: today's numbers on top, quick period and payment filters, then every sale grouped by day.
 * People without "view all sales" only ever see (and total) their own. Balances come from owedSql(); returns and refunds are taken off.
 */
export default async function SalesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  if (!canAny(user, ["sales.view_own", "sales.view_all"])) redirect("/forbidden");
  const viewAll = can(user, "sales.view_all");
  const sp = await searchParams;
  const currency = await getCurrency();
  const money = (v: Prisma.Decimal | string) => formatMoney(v, currency);
  const q = sp.q?.trim().slice(0, 80) ?? "";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as StatusKey) : undefined;
  const today = todayYmd();
  const yesterday = shift(today, -1);

  const owed = owedSql("s");
  const day = Prisma.sql`(s."createdAt" AT TIME ZONE ${TZ})::date`;
  const mine: Prisma.Sql = viewAll ? Prisma.empty : Prisma.sql`AND s."salespersonId" = ${user.id}`; // without "view all", only your own sales, everywhere on this page

  // every filter except the payment status (the status pills show how many each has under the other filters)
  const base: Prisma.Sql[] = [];
  if (viewAll && sp.seller) base.push(Prisma.sql`s."salespersonId" = ${sp.seller}`);
  if (sp.customer) base.push(Prisma.sql`s."customerId" = ${sp.customer}`);
  if (isDate(sp.from)) base.push(Prisma.sql`${day} >= ${sp.from}::date`);
  if (isDate(sp.to)) base.push(Prisma.sql`${day} <= ${sp.to}::date`);
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    base.push(Prisma.sql`(s."saleNo" ILIKE ${like} OR c."name" ILIKE ${like})`);
  }
  const conds = [...base];
  if (status === "cancelled") conds.push(Prisma.sql`s."status" = 'CANCELLED'`);
  else if (status) conds.push(Prisma.sql`s."status" = 'COMPLETED' AND s."paymentStatus" = ${PAY[status]}::"PaymentStatus"`);
  const whereOf = (cs: Prisma.Sql[]) => Prisma.sql`WHERE 1 = 1 ${mine} ${cs.length ? Prisma.sql`AND ${Prisma.join(cs, " AND ")}` : Prisma.empty}`;
  const from = Prisma.sql`FROM "Sale" s LEFT JOIN "Customer" c ON c."id" = s."customerId" JOIN "User" u ON u."id" = s."salespersonId"`;

  const weekStart = shift(today, -6);
  const monthStart = `${today.slice(0, 8)}01`;
  const prevMonthStart = (() => {
    const [y, m] = today.split("-").map(Number) as [number, number];
    return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
  })();

  const [kpi, statusCounts, rows, sums, customer, sellers] = await Promise.all([
    // the four numbers on top: always the whole book (for your own sales if you may not see all), never narrowed by the filters
    db.$queryRaw<{ t_n: bigint; t_net: Prisma.Decimal | null; t_paid: Prisma.Decimal | null; y_net: Prisma.Decimal | null; w_n: bigint; w_net: Prisma.Decimal | null; m_n: bigint; m_net: Prisma.Decimal | null; pm_net: Prisma.Decimal | null; u_n: bigint; u_owed: Prisma.Decimal | null }[]>`
      SELECT COUNT(*) FILTER (WHERE ${day} = ${today}::date) AS t_n,
             SUM(s."total" - s."returnedTotal") FILTER (WHERE ${day} = ${today}::date) AS t_net,
             SUM(s."amountPaid" - s."refundedTotal") FILTER (WHERE ${day} = ${today}::date) AS t_paid,
             SUM(s."total" - s."returnedTotal") FILTER (WHERE ${day} = ${yesterday}::date) AS y_net,
             COUNT(*) FILTER (WHERE ${day} >= ${weekStart}::date) AS w_n,
             SUM(s."total" - s."returnedTotal") FILTER (WHERE ${day} >= ${weekStart}::date) AS w_net,
             COUNT(*) FILTER (WHERE ${day} >= ${monthStart}::date) AS m_n,
             SUM(s."total" - s."returnedTotal") FILTER (WHERE ${day} >= ${monthStart}::date) AS m_net,
             SUM(s."total" - s."returnedTotal") FILTER (WHERE ${day} >= ${prevMonthStart}::date AND ${day} < ${monthStart}::date) AS pm_net,
             COUNT(*) FILTER (WHERE ${owed} > 0) AS u_n,
             SUM(${owed}) FILTER (WHERE ${owed} > 0) AS u_owed
        FROM "Sale" s WHERE s."status" = 'COMPLETED' ${mine}`,
    db.$queryRaw<{ st: string; ps: string; n: bigint }[]>`SELECT s."status"::text AS st, s."paymentStatus"::text AS ps, COUNT(*) AS n ${from} ${whereOf(base)} GROUP BY 1, 2`,
    db.$queryRaw<Row[]>`
      SELECT s."id", s."saleNo", s."createdAt", ${day}::text AS day, s."status"::text AS status, s."paymentStatus"::text AS "paymentStatus", s."channel"::text AS channel,
             s."total", s."returnedTotal", s."amountPaid", s."refundedTotal", ${owed} AS owed,
             c."name" AS "customerName", u."name" AS "sellerName", (SELECT COUNT(*) FROM "SaleItem" i WHERE i."saleId" = s."id") AS items
        ${from} ${whereOf(conds)}
       ORDER BY s."createdAt" DESC, s."id" DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
    // totals for the whole filtered list (cancelled sales never count)
    db.$queryRaw<{ n: bigint; net: Prisma.Decimal | null; paid: Prisma.Decimal | null; open: Prisma.Decimal | null }[]>`
      SELECT COUNT(*) AS n,
             SUM(s."total" - s."returnedTotal") FILTER (WHERE s."status" = 'COMPLETED') AS net,
             SUM(s."amountPaid" - s."refundedTotal") FILTER (WHERE s."status" = 'COMPLETED') AS paid,
             SUM(${owed}) FILTER (WHERE s."status" = 'COMPLETED' AND ${owed} > 0) AS open
        ${from} ${whereOf(conds)}`,
    sp.customer ? db.customer.findUnique({ where: { id: sp.customer }, select: { name: true } }) : null,
    viewAll ? db.user.findMany({ where: { sales: { some: {} } }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
  ]);

  // totals per day for the days shown (a day can run over two pages, so these come from the database, not from the rows)
  const days = [...new Set(rows.map((r) => r.day))];
  const dayTotals = days.length
    ? await db.$queryRaw<{ day: string; n: bigint; net: Prisma.Decimal | null }[]>`
        SELECT ${day}::text AS day, COUNT(*) AS n, SUM(s."total" - s."returnedTotal") FILTER (WHERE s."status" = 'COMPLETED') AS net
          ${from} ${whereOf(conds)} AND ${day} IN (${Prisma.join(days.map((d) => Prisma.sql`${d}::date`))})
         GROUP BY 1`
    : [];
  const perDay = new Map(dayTotals.map((d) => [d.day, d]));

  const n = (v: bigint | number | null | undefined) => Number(v ?? 0);
  const k = kpi[0];
  const todayNet = dec(k?.t_net);
  const yNet = dec(k?.y_net);
  const todayPaid = dec(k?.t_paid);
  const monthNet = dec(k?.m_net);
  const pmNet = dec(k?.pm_net);
  const weekNet = dec(k?.w_net);
  const change = (cur: Prisma.Decimal, prev: Prisma.Decimal) => (prev.gt(0) ? Math.round(cur.minus(prev).div(prev).mul(100).toNumber()) : null);
  const vsYesterday = change(todayNet, yNet);

  const count = (f: (r: { st: string; ps: string }) => boolean) => statusCounts.filter(f).reduce((s, r) => s + n(r.n), 0);
  const counts: Record<"all" | StatusKey, number> = {
    all: count(() => true),
    paid: count((r) => r.st === "COMPLETED" && r.ps === "PAID"),
    partial: count((r) => r.st === "COMPLETED" && r.ps === "PARTIALLY_PAID"),
    unpaid: count((r) => r.st === "COMPLETED" && r.ps === "UNPAID"),
    cancelled: count((r) => r.st === "CANCELLED"),
  };

  const total = n(sums[0]?.n);
  const sumNet = dec(sums[0]?.net);
  const sumPaid = dec(sums[0]?.paid);
  const sumOpen = dec(sums[0]?.open);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(q || sp.customer || status || sp.seller || sp.from || sp.to);

  const link = (over: Partial<Search>) => {
    const m = { q: q || undefined, customer: sp.customer, status, seller: sp.seller, from: sp.from, to: sp.to, ...over } as Record<string, string | undefined>;
    const qs = new URLSearchParams(Object.entries(m).filter(([, v]) => v) as [string, string][]).toString();
    return `/sales${qs ? `?${qs}` : ""}`;
  };
  const periods = [
    { label: "Today", from: today, to: today },
    { label: "Yesterday", from: yesterday, to: yesterday },
    { label: "Last 7 days", from: weekStart, to: today },
    { label: "This month", from: monthStart, to: today },
  ];
  const activePeriod = periods.find((p) => p.from === sp.from && p.to === sp.to);
  const pills: { key: "all" | StatusKey; label: string }[] = [
    { key: "all", label: "All" },
    { key: "paid", label: "Paid" },
    { key: "partial", label: "Part paid" },
    { key: "unpaid", label: "Unpaid" },
    ...(counts.cancelled > 0 || status === "cancelled" ? [{ key: "cancelled" as const, label: "Cancelled" }] : []),
  ];
  const cols = viewAll ? COLS_ALL : COLS_OWN;
  const from1 = (page - 1) * PAGE_SIZE + 1;

  return (
    <>
      <PageHeader
        title="Sales history"
        description={viewAll ? "Every sale made by every employee." : "The sales you have made."}
        actions={
          can(user, "sales.pos") && (
            <Link href="/pos" className="btn-primary">
              <Plus size={16} /> New sale
            </Link>
          )
        }
      />

      <KpiStrip className="mb-5">
        <KpiCard
          icon={Receipt}
          tone="navy"
          label="Sold today"
          value={money(todayNet)}
          hint={`${n(k?.t_n)} sale${n(k?.t_n) === 1 ? "" : "s"}${todayNet.gt(0) ? ` · ${money(todayPaid)} paid` : ""}${vsYesterday !== null ? ` · ${vsYesterday >= 0 ? "+" : ""}${vsYesterday}% vs yesterday` : yNet.isZero() ? "" : ` · yesterday ${money(yNet)}`}`}
          href={link({ from: today, to: today, page: undefined })}
          active={sp.from === today && sp.to === today}
        />
        <KpiCard icon={CalendarDays} tone="blue" label="Last 7 days" value={money(weekNet)} hint={`${n(k?.w_n)} sale${n(k?.w_n) === 1 ? "" : "s"} · about ${money(weekNet.div(7).toDecimalPlaces(0))} a day`} href={link({ from: weekStart, to: today, page: undefined })} active={sp.from === weekStart && sp.to === today} />
        <KpiCard
          icon={TrendingUp}
          tone="green"
          label="This month"
          value={money(monthNet)}
          hint={`${n(k?.m_n)} sale${n(k?.m_n) === 1 ? "" : "s"}${pmNet.gt(0) ? ` · last month ${money(pmNet)}` : ""}`}
          href={link({ from: monthStart, to: today, page: undefined })}
          active={sp.from === monthStart && sp.to === today}
        />
        <KpiCard icon={Wallet} tone={n(k?.u_n) > 0 ? "yellow" : "slate"} label="Not paid yet" value={money(dec(k?.u_owed))} hint={`${n(k?.u_n)} invoice${n(k?.u_n) === 1 ? "" : "s"} with a balance`} href={n(k?.u_n) > 0 ? link({ status: "unpaid", from: undefined, to: undefined, page: undefined }) : undefined} />
      </KpiStrip>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <nav className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="Payment filters">
          {pills.map((p) => {
            const active = (status ?? "all") === p.key;
            return (
              <Link key={p.key} href={link({ status: p.key === "all" ? undefined : p.key, page: undefined })} aria-current={active ? "page" : undefined} className={cn("inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition", active ? "border-navy-700 bg-navy-700 text-white" : "border-line bg-white text-slate-600 hover:border-navy-200 hover:text-slate-900")}>
                {p.label}
                <span className={cn("rounded-full px-1.5 text-xs font-semibold", active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600")}>{counts[p.key]}</span>
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

      <form method="get" action="/sales" className="card card-pad mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_auto_auto_auto_auto]">
        {sp.customer && <input type="hidden" name="customer" value={sp.customer} />}
        {status && <input type="hidden" name="status" value={status} />}
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input name="q" defaultValue={q} placeholder="Invoice no. or customer" className="input pl-9" aria-label="Search sales" />
        </div>
        {viewAll ? (
          <select name="seller" defaultValue={sp.seller ?? ""} className="input" aria-label="Employee">
            <option value="">All employees</option>
            {sellers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="hidden lg:block" />
        )}
        <input type="date" name="from" defaultValue={sp.from ?? ""} className="input" aria-label="From date" />
        <input type="date" name="to" defaultValue={sp.to ?? ""} className="input" aria-label="To date" />
        <button className="btn-primary" type="submit">
          Apply
        </button>
        {hasFilters ? (
          <Link href="/sales" className="btn-secondary">
            Clear
          </Link>
        ) : (
          <span className="hidden lg:block" />
        )}
        {customer && (
          <p className="text-sm text-slate-600 sm:col-span-2 lg:col-span-6">
            Showing sales to <span className="font-semibold text-slate-900">{customer.name}</span> ·{" "}
            <Link href={link({ customer: undefined, page: undefined })} className="font-medium text-navy-700 hover:underline">
              show everyone
            </Link>
          </p>
        )}
      </form>

      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon={<Receipt size={22} />} title={hasFilters ? "No sales match your filters" : "No sales yet"} description={hasFilters ? "Try another period or clear the filters." : "Sales appear here as soon as they are completed in the POS."} />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-line bg-slate-50/60 px-4 py-2.5 text-sm sm:px-5">
              <span className="text-slate-600">
                {total} sale{total === 1 ? "" : "s"}
                {activePeriod ? ` · ${activePeriod.label.toLowerCase()}` : ""}
              </span>
              <span className="text-slate-600">
                Sold <span className="font-semibold text-slate-900">{money(sumNet)}</span> · paid <span className="font-semibold text-emerald-700">{money(sumPaid)}</span> · not paid <span className={cn("font-semibold", sumOpen.gt(0) ? "text-brand-red-dark" : "text-slate-900")}>{money(sumOpen)}</span>
              </span>
            </div>

            <div className={cn("hidden border-b border-line px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 lg:grid lg:items-center lg:gap-x-4", cols)} aria-hidden>
              <span>Invoice</span>
              <span>Customer</span>
              {viewAll && <span>Sold by</span>}
              <span className="text-right">Total</span>
              <span className="text-right">Paid</span>
              <span className="text-right">Balance</span>
              <span>Status</span>
            </div>

            {days.map((d) => {
              const t = perDay.get(d);
              return (
                <section key={d} aria-label={dayTitle(d, today, yesterday)}>
                  <h2 className="flex items-center justify-between gap-3 border-b border-line bg-slate-50/90 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 sm:px-5">
                    <span>{dayTitle(d, today, yesterday)}</span>
                    <span className="normal-case tracking-normal">
                      {n(t?.n)} sale{n(t?.n) === 1 ? "" : "s"} · <span className="font-semibold text-slate-800">{money(dec(t?.net))}</span>
                    </span>
                  </h2>
                  <ul>
                    {rows
                      .filter((r) => r.day === d)
                      .map((r) => {
                        const cancelled = r.status === "CANCELLED";
                        const o = cancelled ? new D(0) : dec(r.owed);
                        const net = dec(r.total).minus(dec(r.returnedTotal));
                        return (
                          <li key={r.id} className={cn("grid grid-cols-2 items-center gap-x-4 gap-y-2 border-b border-line/70 px-4 py-3 last:border-b-0 sm:px-5", cols, cancelled && "opacity-70")}>
                            <div className="min-w-0">
                              <Link href={`/sales/${r.id}`} className="block truncate font-mono text-sm font-semibold text-navy-700 hover:underline">
                                {r.saleNo}
                              </Link>
                              <span className="block text-xs text-slate-500">
                                {timeOf(r.createdAt)} · {n(r.items)} item{n(r.items) === 1 ? "" : "s"}
                              </span>
                            </div>
                            <div className="justify-self-end lg:hidden">
                              <SaleStatusBadge status={r.status} paymentStatus={r.paymentStatus} />
                            </div>
                            <div className="col-span-2 min-w-0 lg:col-span-1">
                              <span className="block truncate text-sm font-medium text-slate-900">{r.customerName ?? <span className="font-normal text-slate-400">Walk-in</span>}</span>
                              {r.channel === "RESELLER" && <span className="text-xs text-slate-500">Winga report</span>}
                            </div>
                            {viewAll && (
                              <div className="col-span-2 min-w-0 truncate text-sm text-slate-600 lg:col-span-1">
                                <span className="text-xs text-slate-500 lg:hidden">Sold by </span>
                                {r.sellerName}
                              </div>
                            )}
                            <Money label="Total" tone={cancelled ? "struck" : "strong"}>
                              {money(net)}
                              {dec(r.returnedTotal).gt(0) && !cancelled && <span className="block text-[11px] font-normal text-slate-500">of {money(r.total)}, some returned</span>}
                            </Money>
                            <Money label="Paid" tone={cancelled || dec(r.amountPaid).minus(dec(r.refundedTotal)).isZero() ? "muted" : "plain"}>
                              {money(dec(r.amountPaid).minus(dec(r.refundedTotal)))}
                            </Money>
                            <Money label="Balance" tone={o.gt(0) ? "red" : "muted"}>
                              {o.gt(0) ? money(o) : "—"}
                            </Money>
                            <div className="hidden lg:block">
                              <SaleStatusBadge status={r.status} paymentStatus={r.paymentStatus} />
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
                      <ChevronLeft size={15} /> Previous
                    </Link>
                  )}
                  {page < pages && (
                    <Link href={link({ page: String(page + 1) })} className="btn-secondary !px-3 !py-1.5">
                      Next <ChevronRight size={15} />
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

const TONES = { strong: "font-semibold text-slate-900", plain: "text-slate-800", muted: "text-slate-400", red: "font-semibold text-brand-red-dark", struck: "text-slate-400 line-through" } as const;

/** One money cell: right-aligned on desktop, a label + value line on a phone. */
function Money({ label, tone, children }: { label: string; tone: keyof typeof TONES; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 lg:block lg:text-right">
      <span className="text-xs text-slate-500 lg:hidden">{label}</span>
      <span className={cn("text-sm tabular-nums", TONES[tone])}>{children}</span>
    </div>
  );
}
