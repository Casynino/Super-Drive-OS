import Link from "next/link";
import { CalendarClock, CalendarDays, ChevronLeft, ChevronRight, Clock, FileText, HandCoins, Search, Users, Wallet } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import KpiCard from "@/components/dashboard/KpiCard";
import { Prisma } from "@/generated/prisma/client";
import { can } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { todayYmd } from "@/lib/dashboard/range";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { owedSql } from "@/lib/sales/owed";
import { getBusinessProfile, getCurrency } from "@/lib/settings";
import { cn, formatDate } from "@/lib/utils";
import RemindButton from "@/components/credit/RemindButton";
import { buildReminder, loadLastReminders, loadLateInvoices, remindedText, reminderLink } from "@/lib/credit/reminders";
import { PaymentStatusBadge } from "../sales/StatusBadge";

export const metadata = { title: "Credit management" };

const D = Prisma.Decimal;
const dec = (v: Prisma.Decimal | string | number | null | undefined) => new D((v ?? 0).toString());
const PAGE_SIZE = 40;

const VIEWS = ["all", "overdue", "soon", "later", "paid"] as const;
type View = (typeof VIEWS)[number];
const AGES = { d1_30: [1, 30, "1–30 days late"], d31_60: [31, 60, "31–60 days late"], d61_90: [61, 90, "61–90 days late"], d90_plus: [91, 100000, "Over 90 days late"] } as const;
type Age = keyof typeof AGES;
const SORTS = { due: "Due date, oldest first", owed: "Biggest balance first", new: "Newest invoice first" } as const;
type Sort = keyof typeof SORTS;
type Search = { view?: string; age?: string; by?: string; q?: string; sort?: string; page?: string };

// Invoice list: customer | invoice | due | total | paid | balance | action
const COLS = "lg:grid-cols-[minmax(0,1.5fr)_minmax(10rem,1.1fr)_minmax(0,1.2fr)_6.5rem_6.5rem_7.5rem_12.5rem]";
// Customer list: customer | invoices | next due | late | owes | action
const CCOLS = "lg:grid-cols-[minmax(0,1.9fr)_5rem_minmax(0,1.3fr)_8rem_8rem_12.5rem]";

/** "12 days late", "due today", "due in 3 days": how far a due date is from today (days > 0 = late). */
function dueState(days: number | null, owed: Prisma.Decimal) {
  if (owed.lte(0)) return { text: "Paid", badge: "badge-green", late: false };
  if (days === null) return { text: "No due date", badge: "badge-gray", late: false };
  if (days > 0) return { text: `${days} day${days === 1 ? "" : "s"} late`, badge: "badge-red", late: true };
  if (days === 0) return { text: "Due today", badge: "badge-yellow", late: false };
  return { text: `Due in ${-days} day${days === -1 ? "" : "s"}`, badge: days >= -7 ? "badge-yellow" : "badge-gray", late: false };
}

type InvoiceRow = {
  id: string;
  saleNo: string;
  createdAt: Date;
  dueDate: Date | null;
  days: number | null;
  netTotal: Prisma.Decimal | string;
  netPaid: Prisma.Decimal | string;
  owed: Prisma.Decimal | string;
  paymentStatus: "PAID" | "PARTIALLY_PAID" | "UNPAID";
  channel: "SHOP" | "RESELLER";
  customerId: string;
  customerName: string;
  phone: string | null;
};
type CustomerRow = {
  id: string;
  name: string;
  phone: string | null;
  creditLimit: Prisma.Decimal | string;
  invoices: bigint;
  owed: Prisma.Decimal | string;
  overdue: Prisma.Decimal | string;
  oldestDays: number | null;
  nextDue: Date | null;
};

/**
 * Every credit invoice in one place: who owes it, when it is due, how late it is, what was paid and what is left.
 * Read-only (collecting money still happens on the customer's pay screen). Balances always come from owedSql(), never total − paid.
 */
export default async function CreditPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePagePermission("credit.view");
  const sp = await searchParams;
  const currency = await getCurrency();
  const money = (v: Prisma.Decimal | string) => formatMoney(v, currency);
  const canCollect = can(user, "payments.record");
  const today = todayYmd();

  const view: View = (VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as View) : "all";
  const age: Age | undefined = sp.age && sp.age in AGES ? (sp.age as Age) : undefined;
  const by: "invoice" | "customer" = view !== "paid" && sp.by === "customer" ? "customer" : "invoice";
  const q = sp.q?.trim().slice(0, 80) ?? "";
  const sort: Sort = sp.sort && sp.sort in SORTS ? (sp.sort as Sort) : view === "paid" ? "new" : "due";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const owed = owedSql("s");
  const due = Prisma.raw(`s."dueDate"`);
  const daysLate = Prisma.sql`(${today}::date - ${due})`;

  // what counts as a credit invoice: a completed sale to a customer that has a due date (money was left on credit) or still has a balance
  const base = Prisma.sql`s."status" = 'COMPLETED' AND s."customerId" IS NOT NULL AND (${due} IS NOT NULL OR ${owed} > 0)`;
  const viewWhere: Prisma.Sql = age
    ? Prisma.sql`${owed} > 0 AND ${due} < ${today}::date AND ${daysLate} BETWEEN ${AGES[age][0]} AND ${AGES[age][1]}`
    : view === "overdue"
      ? Prisma.sql`${owed} > 0 AND ${due} < ${today}::date`
      : view === "soon"
        ? Prisma.sql`${owed} > 0 AND ${due} >= ${today}::date AND ${due} <= ${today}::date + 7`
        : view === "later"
          ? Prisma.sql`${owed} > 0 AND (${due} IS NULL OR ${due} > ${today}::date + 7)`
          : view === "paid"
            ? Prisma.sql`${owed} <= 0`
            : Prisma.sql`${owed} > 0`;
  const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const search = q ? Prisma.sql`AND (c."name" ILIKE ${like} OR s."saleNo" ILIKE ${like} OR c."phone" ILIKE ${like})` : Prisma.empty;
  const where = Prisma.sql`${base} AND ${viewWhere} ${search}`;

  const invoiceOrder = Prisma.raw(sort === "owed" ? `owed DESC, s."dueDate" ASC` : sort === "new" ? `s."createdAt" DESC` : `s."dueDate" ASC NULLS LAST, s."createdAt" ASC`);
  const customerOrder = Prisma.raw(sort === "owed" ? `owed DESC` : `MIN(s."dueDate") ASC NULLS LAST, owed DESC`);

  const [sumRows, advance] = await Promise.all([
    // numbers for the cards, pills and the age bar: always for the whole book (no search or view filter)
    db.$queryRaw<
      {
        open_n: bigint;
        open_owed: Prisma.Decimal | string | null;
        customers: bigint;
        late_n: bigint;
        late_owed: Prisma.Decimal | string | null;
        soon_n: bigint;
        soon_owed: Prisma.Decimal | string | null;
        later_n: bigint;
        later_owed: Prisma.Decimal | string | null;
        paid_n: bigint;
        a1_owed: Prisma.Decimal | string | null;
        a2_owed: Prisma.Decimal | string | null;
        a3_owed: Prisma.Decimal | string | null;
        a4_owed: Prisma.Decimal | string | null;
      }[]
    >`
      SELECT COUNT(*) FILTER (WHERE ${owed} > 0) AS open_n,
             SUM(${owed}) FILTER (WHERE ${owed} > 0) AS open_owed,
             COUNT(DISTINCT s."customerId") FILTER (WHERE ${owed} > 0) AS customers,
             COUNT(*) FILTER (WHERE ${owed} > 0 AND ${due} < ${today}::date) AS late_n,
             SUM(${owed}) FILTER (WHERE ${owed} > 0 AND ${due} < ${today}::date) AS late_owed,
             COUNT(*) FILTER (WHERE ${owed} > 0 AND ${due} >= ${today}::date AND ${due} <= ${today}::date + 7) AS soon_n,
             SUM(${owed}) FILTER (WHERE ${owed} > 0 AND ${due} >= ${today}::date AND ${due} <= ${today}::date + 7) AS soon_owed,
             COUNT(*) FILTER (WHERE ${owed} > 0 AND (${due} IS NULL OR ${due} > ${today}::date + 7)) AS later_n,
             SUM(${owed}) FILTER (WHERE ${owed} > 0 AND (${due} IS NULL OR ${due} > ${today}::date + 7)) AS later_owed,
             COUNT(*) FILTER (WHERE ${owed} <= 0 AND ${due} IS NOT NULL) AS paid_n,
             SUM(${owed}) FILTER (WHERE ${owed} > 0 AND ${due} < ${today}::date AND ${daysLate} BETWEEN 1 AND 30) AS a1_owed,
             SUM(${owed}) FILTER (WHERE ${owed} > 0 AND ${due} < ${today}::date AND ${daysLate} BETWEEN 31 AND 60) AS a2_owed,
             SUM(${owed}) FILTER (WHERE ${owed} > 0 AND ${due} < ${today}::date AND ${daysLate} BETWEEN 61 AND 90) AS a3_owed,
             SUM(${owed}) FILTER (WHERE ${owed} > 0 AND ${due} < ${today}::date AND ${daysLate} > 90) AS a4_owed
        FROM "Sale" s WHERE ${base}`,
    db.$queryRaw<{ s: Prisma.Decimal | string | null }[]>`
      SELECT COALESCE(SUM(p."amount" - COALESCE(a."s", 0)), 0) AS s
        FROM "Payment" p LEFT JOIN (SELECT "paymentId", SUM("amount") AS s FROM "PaymentAllocation" GROUP BY "paymentId") a ON a."paymentId" = p."id"
       WHERE p."customerId" IS NOT NULL`,
  ]);

  // the list itself (and how many rows it has) for the chosen view
  const [total, invoices, customers] =
    by === "invoice"
      ? await Promise.all([
          db.$queryRaw<{ n: bigint; owed: Prisma.Decimal | string | null }[]>`
            SELECT COUNT(*) AS n, SUM(${owed}) AS owed FROM "Sale" s JOIN "Customer" c ON c."id" = s."customerId" WHERE ${where}`,
          db.$queryRaw<InvoiceRow[]>`
            SELECT s."id", s."saleNo", s."createdAt", s."dueDate", ${daysLate}::int AS days,
                   (s."total" - s."returnedTotal") AS "netTotal", (s."amountPaid" - s."refundedTotal") AS "netPaid", ${owed} AS owed,
                   s."paymentStatus"::text AS "paymentStatus", s."channel"::text AS channel,
                   c."id" AS "customerId", c."name" AS "customerName", c."phone"
              FROM "Sale" s JOIN "Customer" c ON c."id" = s."customerId"
             WHERE ${where} ORDER BY ${invoiceOrder} LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
          Promise.resolve([] as CustomerRow[]),
        ])
      : await Promise.all([
          db.$queryRaw<{ n: bigint; owed: Prisma.Decimal | string | null }[]>`
            SELECT COUNT(*) AS n, SUM(t.owed) AS owed FROM (
              SELECT c."id", SUM(${owed}) AS owed FROM "Sale" s JOIN "Customer" c ON c."id" = s."customerId" WHERE ${where} GROUP BY c."id") t`,
          Promise.resolve([] as InvoiceRow[]),
          db.$queryRaw<CustomerRow[]>`
            SELECT c."id", c."name", c."phone", c."creditLimit", COUNT(*) AS invoices, SUM(${owed}) AS owed,
                   SUM(CASE WHEN ${due} < ${today}::date THEN ${owed} ELSE 0 END) AS overdue,
                   MAX(CASE WHEN ${due} < ${today}::date THEN ${daysLate} END)::int AS "oldestDays",
                   MIN(CASE WHEN ${due} >= ${today}::date THEN ${due} END) AS "nextDue"
              FROM "Sale" s JOIN "Customer" c ON c."id" = s."customerId"
             WHERE ${where} GROUP BY c."id", c."name", c."phone", c."creditLimit"
             ORDER BY ${customerOrder} LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
        ]);

  // WhatsApp reminders: the late invoices of the customers on this page, the shop's number, and when each was last reminded
  const shownIds = [...new Set([...invoices.map((r) => r.customerId), ...customers.map((c) => c.id)])];
  const [lateMap, lastMap, profile] = await Promise.all([loadLateInvoices(db, shownIds, today), loadLastReminders(db, shownIds), getBusinessProfile()]);
  const remind = (customerId: string, name: string, phone: string | null, only?: string) => {
    const late = (lateMap.get(customerId) ?? []).filter((i) => !only || i.id === only);
    if (late.length === 0) return null;
    const text = buildReminder({ businessName: profile.name, businessPhone: profile.phone, paymentAccounts: profile.paymentAccounts, customerName: name, invoices: late, currency });
    return { href: reminderLink(phone, text), saleIds: late.map((i) => i.id), lastText: remindedText(lastMap.get(customerId)) };
  };

  const n = (v: bigint | number | null | undefined) => Number(v ?? 0);
  const s = sumRows[0];
  const openOwed = dec(s?.open_owed);
  const counts: Record<View, number> = { all: n(s?.open_n), overdue: n(s?.late_n), soon: n(s?.soon_n), later: n(s?.later_n), paid: n(s?.paid_n) };
  const advanceHeld = dec(advance[0]?.s);
  const listCount = n(total[0]?.n);
  const listOwed = dec(total[0]?.owed);
  const pages = Math.max(1, Math.ceil(listCount / PAGE_SIZE));
  const from = listCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, listCount);

  const link = (over: Partial<Search>) => {
    const m = { view: view === "all" ? undefined : view, age, by: by === "invoice" ? undefined : by, q: q || undefined, sort: sp.sort && sp.sort in SORTS ? sp.sort : undefined, ...over } as Record<string, string | undefined>;
    const qs = new URLSearchParams(Object.entries(m).filter(([, v]) => v) as [string, string][]).toString();
    return `/credit${qs ? `?${qs}` : ""}`;
  };

  const pills: { key: View; label: string }[] = [
    { key: "all", label: "All open" },
    { key: "overdue", label: "Late" },
    { key: "soon", label: "Due this week" },
    { key: "later", label: "Due later" },
    { key: "paid", label: "Paid" },
  ];
  const ageBar: { key: string; label: string; owed: Prisma.Decimal; color: string; href: string }[] = [
    { key: "notlate", label: "Not late yet", owed: dec(s?.soon_owed).plus(dec(s?.later_owed)), color: "bg-navy-400", href: link({ view: undefined, age: undefined, page: undefined }) },
    { key: "d1_30", label: "1–30 days late", owed: dec(s?.a1_owed), color: "bg-oil-400", href: link({ view: "overdue", age: "d1_30", page: undefined }) },
    { key: "d31_60", label: "31–60 days late", owed: dec(s?.a2_owed), color: "bg-orange-400", href: link({ view: "overdue", age: "d31_60", page: undefined }) },
    { key: "d61_90", label: "61–90 days late", owed: dec(s?.a3_owed), color: "bg-brand-red", href: link({ view: "overdue", age: "d61_90", page: undefined }) },
    { key: "d90_plus", label: "Over 90 days late", owed: dec(s?.a4_owed), color: "bg-brand-red-dark", href: link({ view: "overdue", age: "d90_plus", page: undefined }) },
  ];
  const hasFilters = Boolean(q || age || view !== "all" || by !== "invoice" || sp.sort);

  return (
    <>
      <PageHeader
        title="Credit management"
        description="Every credit invoice: who owes it, when it is due, how late it is and what is left to pay."
        actions={
          can(user, "settings.view") && (
            <Link href="/settings/reminders" className="btn-secondary">
              Automatic reminders
            </Link>
          )
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard icon={Wallet} tone="navy" label="Total owed" value={money(openOwed)} hint={`${counts.all} open invoice${counts.all === 1 ? "" : "s"} · ${n(s?.customers)} customer${n(s?.customers) === 1 ? "" : "s"}`} href={link({ view: undefined, age: undefined, page: undefined })} active={view === "all" && !age} />
        <KpiCard icon={Clock} tone="red" label="Late" value={money(dec(s?.late_owed))} hint={`${counts.overdue} invoice${counts.overdue === 1 ? "" : "s"} past the due date`} href={link({ view: "overdue", age: undefined, page: undefined })} active={view === "overdue" && !age} />
        <KpiCard icon={CalendarClock} tone="yellow" label="Due this week" value={money(dec(s?.soon_owed))} hint={`${counts.soon} invoice${counts.soon === 1 ? "" : "s"} in the next 7 days`} href={link({ view: "soon", age: undefined, page: undefined })} active={view === "soon"} />
        <KpiCard icon={CalendarDays} tone="blue" label="Due later" value={money(dec(s?.later_owed))} hint={`${counts.later} invoice${counts.later === 1 ? "" : "s"} after that`} href={link({ view: "later", age: undefined, page: undefined })} active={view === "later"} />
      </div>

      {openOwed.gt(0) && (
        <section className="card mb-5 px-4 py-4 sm:px-5" aria-label="How old the debt is">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">How old is the debt?</h2>
            <p className="text-xs text-slate-500">Press a part to see those invoices</p>
          </div>
          <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-100" role="img" aria-label="Share of the debt by how late it is">
            {ageBar.map((a) => {
              const pct = a.owed.div(openOwed).mul(100).toNumber();
              return pct > 0 ? <Link key={a.key} href={a.href} title={`${a.label}: ${money(a.owed)}`} className={cn("h-full transition hover:opacity-80", a.color)} style={{ width: `${Math.max(pct, 1.5)}%` }} /> : null;
            })}
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-5">
            {ageBar.map((a) => (
              <li key={a.key}>
                <Link href={a.href} className={cn("flex items-start gap-2 rounded-lg px-1.5 py-1 transition hover:bg-slate-50", a.key === age && "bg-slate-100")}>
                  <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", a.color)} />
                  <span className="min-w-0">
                    <span className="block truncate text-xs text-slate-500">{a.label}</span>
                    <span className={cn("block text-sm font-semibold", a.owed.isZero() ? "text-slate-400" : a.key === "notlate" ? "text-slate-900" : "text-brand-red-dark")}>{money(a.owed)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {advanceHeld.gt(0) && <p className="mt-3 rounded-lg bg-oil-soft px-3 py-2 text-xs text-yellow-900">Customers have also paid {money(advanceHeld)} in advance that is not yet used on an invoice.</p>}
        </section>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <nav className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="Credit filters">
          {pills.map((p) => {
            const active = view === p.key && !age;
            return (
              <Link key={p.key} href={link({ view: p.key === "all" ? undefined : p.key, age: undefined, by: p.key === "paid" ? undefined : by === "invoice" ? undefined : by, page: undefined })} aria-current={active ? "page" : undefined} className={cn("inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition", active ? "border-navy-700 bg-navy-700 text-white" : "border-line bg-white text-slate-600 hover:border-navy-200 hover:text-slate-900")}>
                {p.label}
                <span className={cn("rounded-full px-1.5 text-xs font-semibold", active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600")}>{counts[p.key]}</span>
              </Link>
            );
          })}
          {age && <span className="inline-flex shrink-0 items-center rounded-full border border-navy-700 bg-navy-700 px-3.5 py-1.5 text-sm font-medium text-white">{AGES[age][2]}</span>}
        </nav>
        {view !== "paid" && (
          <div className="inline-flex rounded-xl border border-line bg-white p-0.5 text-sm font-medium" role="group" aria-label="Show as">
            {(["invoice", "customer"] as const).map((k) => (
              <Link key={k} href={link({ by: k === "invoice" ? undefined : k, page: undefined })} aria-current={by === k ? "page" : undefined} className={cn("inline-flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 transition", by === k ? "bg-navy-700 text-white" : "text-slate-600 hover:text-slate-900")}>
                {k === "invoice" ? <FileText size={14} /> : <Users size={14} />}
                {k === "invoice" ? "By invoice" : "By customer"}
              </Link>
            ))}
          </div>
        )}
      </div>

      <form method="get" action="/credit" className="card card-pad mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_auto_auto]">
        {view !== "all" && <input type="hidden" name="view" value={view} />}
        {age && <input type="hidden" name="age" value={age} />}
        {by === "customer" && <input type="hidden" name="by" value="customer" />}
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input name="q" defaultValue={q} placeholder="Customer, phone or invoice number" className="input pl-9" aria-label="Search" />
        </div>
        <select name="sort" defaultValue={sort} className="input" aria-label="Sort by">
          {Object.entries(SORTS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <button className="btn-primary">Apply</button>
        {hasFilters ? (
          <Link href="/credit" className="btn-secondary">
            Clear
          </Link>
        ) : (
          <span className="hidden lg:block" />
        )}
      </form>

      <div className="card overflow-hidden">
        {listCount === 0 ? (
          <EmptyState icon={<HandCoins size={22} />} title={hasFilters ? "Nothing matches" : "No customer owes anything"} description={hasFilters ? "Try another filter or clear the search." : "Credit sales will show here until they are paid."} />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-slate-50/60 px-4 py-2.5 text-sm sm:px-5">
              <span className="text-slate-600">
                {by === "invoice" ? `${listCount} invoice${listCount === 1 ? "" : "s"}` : `${listCount} customer${listCount === 1 ? "" : "s"}`}
                {view !== "paid" && (
                  <>
                    {" · still owed "}
                    <span className="font-semibold text-slate-900">{money(listOwed)}</span>
                  </>
                )}
              </span>
              <span className="text-xs text-slate-500">{SORTS[sort]}</span>
            </div>

            {by === "invoice" ? (
              <>
                <div className={cn("hidden border-b border-line px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 lg:grid lg:items-center lg:gap-x-4", COLS)} aria-hidden>
                  <span>Customer</span>
                  <span>Invoice</span>
                  <span>Due</span>
                  <span className="text-right">Total</span>
                  <span className="text-right">Paid</span>
                  <span className="text-right">Balance</span>
                  <span />
                </div>
                <ul>
                  {invoices.map((r) => {
                    const o = dec(r.owed);
                    const st = dueState(r.days, o);
                    return (
                      <li key={r.id} className={cn("grid grid-cols-2 items-center gap-x-4 gap-y-2.5 border-b border-l-[3px] border-b-line/70 px-4 py-3.5 last:border-b-0 sm:px-5", COLS, st.late ? "border-l-brand-red" : "border-l-transparent")}>
                        <div className="col-span-2 min-w-0 lg:col-span-1">
                          <Link href={`/customers/${r.customerId}`} className="block truncate text-sm font-semibold text-navy-700 hover:underline">
                            {r.customerName}
                          </Link>
                          <span className="block truncate text-xs text-slate-500">
                            {r.phone ?? "No phone"}
                            {r.channel === "RESELLER" && <span className="ml-1.5 font-medium text-slate-600">· Winga</span>}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <Link href={`/sales/${r.id}`} className="block truncate font-mono text-sm font-medium text-navy-700 hover:underline">
                            {r.saleNo}
                          </Link>
                          <span className="mt-0.5 block text-xs text-slate-500">{formatDate(r.createdAt)}</span>
                        </div>
                        <div className="min-w-0 justify-self-end text-right lg:justify-self-start lg:text-left">
                          <span className="block text-sm font-medium tabular-nums text-slate-900">{r.dueDate ? formatDate(r.dueDate) : "—"}</span>
                          <span className={cn("mt-0.5 inline-block", st.badge)}>{st.text}</span>
                        </div>
                        <Amount label="Total" value={money(r.netTotal)} />
                        <Amount label="Paid" value={money(r.netPaid)} muted={dec(r.netPaid).isZero()} />
                        <div className="flex items-center justify-between gap-2 lg:block lg:text-right">
                          <span className="text-xs text-slate-500 lg:hidden">Balance</span>
                          <span>
                            <span className={cn("block text-sm font-bold tabular-nums", o.gt(0) ? (st.late ? "text-brand-red-dark" : "text-slate-900") : "text-emerald-700")}>{money(o.gt(0) ? o : new D(0))}</span>
                            {o.gt(0) && (
                              <span className="mt-0.5 inline-block lg:mt-1">
                                <PaymentStatusBadge status={r.paymentStatus} />
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="col-span-2 flex flex-wrap items-start gap-2 lg:col-span-1 lg:justify-end">
                          {st.late && (() => {
                            const rm = remind(r.customerId, r.customerName, r.phone, r.id);
                            return rm ? <RemindButton href={rm.href} customerId={r.customerId} saleIds={rm.saleIds} lastText={rm.lastText} /> : null;
                          })()}
                          {o.gt(0) && canCollect ? (
                            <Link href={`/customers/${r.customerId}/pay`} className="btn-primary !px-3 !py-1.5 text-sm">
                              Collect
                            </Link>
                          ) : (
                            <Link href={`/sales/${r.id}`} className="btn-secondary !px-3 !py-1.5 text-sm">
                              Open
                            </Link>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <>
                <div className={cn("hidden border-b border-line px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 lg:grid lg:items-center lg:gap-x-4", CCOLS)} aria-hidden>
                  <span>Customer</span>
                  <span className="text-right">Invoices</span>
                  <span>Next payment due</span>
                  <span className="text-right">Late</span>
                  <span className="text-right">Owes</span>
                  <span />
                </div>
                <ul>
                  {customers.map((c) => {
                    const late = dec(c.overdue);
                    const lim = dec(c.creditLimit);
                    const owes = dec(c.owed);
                    return (
                      <li key={c.id} className={cn("grid grid-cols-2 items-center gap-x-4 gap-y-2.5 border-b border-l-[3px] border-b-line/70 px-4 py-3.5 last:border-b-0 sm:px-5", CCOLS, late.gt(0) ? "border-l-brand-red" : "border-l-transparent")}>
                        <div className="col-span-2 min-w-0 lg:col-span-1">
                          <Link href={`/customers/${c.id}`} className="block truncate text-sm font-semibold text-navy-700 hover:underline">
                            {c.name}
                          </Link>
                          <span className="block truncate text-xs text-slate-500">
                            {c.phone ?? "No phone"}
                            {lim.gt(0) && (
                              <span className="ml-1.5">
                                · limit {money(lim)}
                                {owes.gt(lim) ? " (over)" : ""}
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 lg:block lg:text-right">
                          <span className="text-xs text-slate-500 lg:hidden">Open invoices</span>
                          <span className="text-sm font-medium tabular-nums text-slate-800">{n(c.invoices)}</span>
                        </div>
                        <div className="min-w-0 justify-self-end text-right lg:justify-self-start lg:text-left">
                          {c.nextDue ? (
                            <>
                              <span className="block text-sm font-medium tabular-nums text-slate-900">{formatDate(c.nextDue)}</span>
                              <span className="text-xs text-slate-500">next invoice due</span>
                            </>
                          ) : (
                            <span className="text-sm text-slate-400">—</span>
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-2 lg:block lg:text-right">
                          <span className="text-xs text-slate-500 lg:hidden">Late</span>
                          <span>
                            <span className={cn("block text-sm font-semibold tabular-nums", late.gt(0) ? "text-brand-red-dark" : "text-slate-400")}>{late.gt(0) ? money(late) : "—"}</span>
                            {late.gt(0) && c.oldestDays ? <span className="block text-xs text-slate-500">oldest {c.oldestDays} d</span> : null}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 lg:block lg:text-right">
                          <span className="text-xs text-slate-500 lg:hidden">Owes</span>
                          <span className="text-sm font-bold tabular-nums text-slate-900">{money(owes)}</span>
                        </div>
                        <div className="col-span-2 flex flex-wrap items-start gap-2 lg:col-span-1 lg:justify-end">
                          {late.gt(0) && (() => {
                            const rm = remind(c.id, c.name, c.phone);
                            return rm ? <RemindButton href={rm.href} customerId={c.id} saleIds={rm.saleIds} lastText={rm.lastText} /> : null;
                          })()}
                          {canCollect ? (
                            <Link href={`/customers/${c.id}/pay`} className="btn-primary !px-3 !py-1.5 text-sm">
                              Collect
                            </Link>
                          ) : (
                            <Link href={`/customers/${c.id}`} className="btn-secondary !px-3 !py-1.5 text-sm">
                              Open
                            </Link>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            {pages > 1 && (
              <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm sm:px-5">
                <span className="text-slate-500">
                  {from}–{to} of {listCount}
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

/** One money figure: a plain right-aligned cell on desktop, a label + value line on a phone. */
function Amount({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 lg:block lg:text-right">
      <span className="text-xs text-slate-500 lg:hidden">{label}</span>
      <span className={cn("text-sm tabular-nums", muted ? "text-slate-400" : "text-slate-800")}>{value}</span>
    </div>
  );
}
