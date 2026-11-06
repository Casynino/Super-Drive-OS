import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, ScrollText, Search } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { Prisma, type CashTxType } from "@/generated/prisma/client";
import { can } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { TX_LABEL, defaultLocationId, listAccounts } from "@/lib/cash/ledger";
import { todayYmd } from "@/lib/dashboard/range";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { getCurrency } from "@/lib/settings";
import { cn } from "@/lib/utils";

export const metadata = { title: "Ledger" };

const PAGE_SIZE = 40;
const TZ = "Africa/Dar_es_Salaam";
type Search = { q?: string; type?: string; dir?: string; account?: string; by?: string; from?: string; to?: string; page?: string };
const isDate = (s?: string) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));
const D = Prisma.Decimal;
const dec = (v: Prisma.Decimal | string | number | null | undefined) => new D((v ?? 0).toString());
const shift = (ymd: string, days: number) => new Date(new Date(`${ymd}T12:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
const timeOf = (d: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(d);
const dayTitle = (key: string, today: string, yesterday: string) =>
  key === today ? "Today" : key === yesterday ? "Yesterday" : new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));

// Moves of money between our own accounts and opening balances are not income or spending
const INTERNAL = Prisma.sql`('DEPOSIT_IN', 'DEPOSIT_OUT', 'OPENING_BALANCE')`;
const BADGE: Record<CashTxType, string> = {
  SALE_PAYMENT: "badge-green",
  COLLECTION: "badge-green",
  REFUND: "badge-yellow",
  EXPENSE: "badge-red",
  EXPENSE_REVERSAL: "badge-gray",
  SUPPLIER_PAYMENT: "badge-red",
  DEPOSIT_OUT: "badge-blue",
  DEPOSIT_IN: "badge-blue",
  WITHDRAWAL: "badge-red",
  ADJUSTMENT: "badge-gray",
  OPENING_BALANCE: "badge-gray",
  CLOSING_DIFFERENCE: "badge-gray",
};
/** the page of the record a ledger row came from, when there is one */
const sourceHref = (type: string, id: string) => (type === "Payment" ? `/payments/${id}` : type === "Expense" ? `/expenses/${id}` : type === "DailyClosing" ? `/closing/${id}` : type === "BankDeposit" ? "/deposits" : null);

// Time | what | type | account | by | out | in
const COLS = "lg:grid-cols-[5.5rem_minmax(0,2.4fr)_9rem_minmax(0,1.1fr)_minmax(0,0.9fr)_8rem_8rem]";

type Row = {
  id: string;
  createdAt: Date;
  businessDate: Date;
  type: CashTxType;
  amount: Prisma.Decimal | string;
  referenceType: string;
  referenceId: string;
  referenceNo: string | null;
  description: string | null;
  accountId: string;
  accountName: string;
  accountNumber: string | null;
  userName: string;
  customerName: string | null;
  expenseText: string | null;
  categoryName: string | null;
};

/**
 * The general ledger: every movement of money in and out of every account, with who recorded it and a running balance. Read-only and
 * for the owner side. Money in / out leave out opening balances and bank deposits between our own accounts (they only move money).
 */
export default async function LedgerPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePagePermission("cash.view");
  const sp = await searchParams;
  const currency = await getCurrency();
  const money = (v: Prisma.Decimal | string) => formatMoney(v, currency);
  const locationId = await defaultLocationId(db);
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const q = sp.q?.trim().slice(0, 80) ?? "";
  const type = sp.type && sp.type in TX_LABEL ? (sp.type as CashTxType) : undefined;
  const dir = sp.dir === "in" || sp.dir === "out" ? sp.dir : undefined;
  const today = todayYmd();
  const yesterday = shift(today, -1);

  const cte = Prisma.sql`
    WITH q AS (
      SELECT t."id", t."createdAt", t."businessDate", t."type", t."amount", t."referenceType", t."referenceId", t."referenceNo", t."description",
             t."accountId", a."name" AS "accountName", a."accountNumber", u."id" AS "userId", u."name" AS "userName",
             c."name" AS "customerName", e."description" AS "expenseText", ec."name" AS "categoryName"
        FROM "CashTransaction" t
        JOIN "CashAccount" a ON a."id" = t."accountId"
        JOIN "User" u ON u."id" = t."userId"
        LEFT JOIN "Payment" p ON t."referenceType" = 'Payment' AND p."id" = t."referenceId"
        LEFT JOIN "Customer" c ON c."id" = p."customerId"
        LEFT JOIN "Expense" e ON t."referenceType" = 'Expense' AND e."id" = t."referenceId"
        LEFT JOIN "ExpenseCategory" ec ON ec."id" = e."categoryId"
       WHERE a."locationId" = ${locationId}
    )`;
  const conds: Prisma.Sql[] = [];
  if (type) conds.push(Prisma.sql`q."type" = ${type}::"CashTxType"`);
  if (dir === "in") conds.push(Prisma.sql`q."amount" > 0`);
  if (dir === "out") conds.push(Prisma.sql`q."amount" < 0`);
  if (sp.account) conds.push(Prisma.sql`q."accountId" = ${sp.account}`);
  if (sp.by) conds.push(Prisma.sql`q."userId" = ${sp.by}`);
  if (isDate(sp.from)) conds.push(Prisma.sql`q."businessDate" >= ${sp.from}::date`);
  if (isDate(sp.to)) conds.push(Prisma.sql`q."businessDate" <= ${sp.to}::date`);
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    conds.push(Prisma.sql`(q."referenceNo" ILIKE ${like} OR q."description" ILIKE ${like} OR q."customerName" ILIKE ${like} OR q."expenseText" ILIKE ${like} OR q."categoryName" ILIKE ${like} OR q."userName" ILIKE ${like} OR q."accountName" ILIKE ${like})`);
  }
  const where = conds.length ? Prisma.sql`WHERE ${Prisma.join(conds, " AND ")}` : Prisma.empty;

  const [rows, sums, accounts, people] = await Promise.all([
    db.$queryRaw<Row[]>`${cte} SELECT q.*, q."businessDate"::text AS day FROM q ${where} ORDER BY q."createdAt" DESC, q."id" DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
    db.$queryRaw<{ n: bigint; inn: Prisma.Decimal | null; out: Prisma.Decimal | null }[]>`
      ${cte} SELECT COUNT(*) AS n,
        SUM(q."amount") FILTER (WHERE q."amount" > 0 AND q."type" NOT IN ${INTERNAL}) AS inn,
        -SUM(q."amount") FILTER (WHERE q."amount" < 0 AND q."type" NOT IN ${INTERNAL}) AS out
      FROM q ${where}`,
    listAccounts(db, locationId, { includeClosed: true }),
    db.$queryRaw<{ id: string; name: string }[]>`SELECT DISTINCT u."id", u."name" FROM "User" u JOIN "CashTransaction" t ON t."userId" = u."id" ORDER BY u."name"`,
  ]);

  const days = [...new Set(rows.map((r) => (r as Row & { day: string }).day))];
  const dayTotals = days.length
    ? await db.$queryRaw<{ day: string; inn: Prisma.Decimal | null; out: Prisma.Decimal | null }[]>`
        ${cte} SELECT q."businessDate"::text AS day,
          SUM(q."amount") FILTER (WHERE q."amount" > 0 AND q."type" NOT IN ${INTERNAL}) AS inn,
          -SUM(q."amount") FILTER (WHERE q."amount" < 0 AND q."type" NOT IN ${INTERNAL}) AS out
        FROM q ${where} ${conds.length ? Prisma.sql`AND` : Prisma.sql`WHERE`} q."businessDate"::text IN (${Prisma.join(days)}) GROUP BY 1`
    : [];
  const perDay = new Map(dayTotals.map((d) => [d.day, d]));

  const total = Number(sums[0]?.n ?? 0);
  const moneyIn = dec(sums[0]?.inn);
  const moneyOut = dec(sums[0]?.out);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(q || type || dir || sp.account || sp.by || sp.from || sp.to);
  const from1 = (page - 1) * PAGE_SIZE + 1;

  const link = (over: Partial<Search>) => {
    const m = { q: q || undefined, type, dir, account: sp.account, by: sp.by, from: sp.from, to: sp.to, ...over } as Record<string, string | undefined>;
    const qs = new URLSearchParams(Object.entries(m).filter(([, v]) => v) as [string, string][]).toString();
    return `/ledger${qs ? `?${qs}` : ""}`;
  };
  const periods = [
    { label: "Today", from: today, to: today },
    { label: "Yesterday", from: yesterday, to: yesterday },
    { label: "This week", from: shift(today, -6), to: today },
    { label: "This month", from: `${today.slice(0, 8)}01`, to: today },
    { label: "This year", from: `${today.slice(0, 5)}01-01`, to: today },
  ];
  const activePeriod = periods.find((p) => p.from === sp.from && p.to === sp.to);

  return (
    <>
      <PageHeader title="General ledger" description="Income and expenses, one line each: what came in, what went out, in which account and who recorded it. Choose a day, a week or a month. Nothing here can be edited: a mistake is put right with a new entry." />

      <div className="mb-3 flex flex-wrap gap-1.5">
        <Link href="/ledger" className={cn("rounded-full border px-3.5 py-1.5 text-sm font-medium transition", !sp.from && !sp.to ? "border-navy-700 bg-navy-700 text-white" : "border-line bg-white text-slate-600 hover:border-navy-200 hover:text-slate-900")}>
          All time
        </Link>
        {periods.map((p) => (
          <Link key={p.label} href={link({ from: p.from, to: p.to, page: undefined })} className={cn("rounded-full border px-3.5 py-1.5 text-sm font-medium transition", activePeriod === p ? "border-navy-700 bg-navy-700 text-white" : "border-line bg-white text-slate-600 hover:border-navy-200 hover:text-slate-900")}>
            {p.label}
          </Link>
        ))}
      </div>

      <form method="get" action="/ledger" className="card card-pad mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="relative sm:col-span-2 lg:col-span-6">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input name="q" defaultValue={q} placeholder="Customer, receipt or reference, expense, account, person..." className="input pl-9" aria-label="Search the ledger" />
        </div>
        <select name="type" defaultValue={type ?? ""} className="input" aria-label="Type">
          <option value="">All types</option>
          {Object.entries(TX_LABEL).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <select name="dir" defaultValue={dir ?? ""} className="input" aria-label="In or out">
          <option value="">In &amp; out</option>
          <option value="in">Money in</option>
          <option value="out">Money out</option>
        </select>
        <select name="account" defaultValue={sp.account ?? ""} className="input" aria-label="Account">
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.accountNumber ? ` · ${a.accountNumber}` : ""}
            </option>
          ))}
        </select>
        <select name="by" defaultValue={sp.by ?? ""} className="input" aria-label="Recorded by">
          <option value="">Anyone</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input type="date" name="from" defaultValue={sp.from ?? ""} className="input" aria-label="From date" />
        <input type="date" name="to" defaultValue={sp.to ?? ""} className="input" aria-label="To date" />
        <div className="flex gap-2 sm:col-span-2 lg:col-span-6">
          <button className="btn-primary" type="submit">
            Apply
          </button>
          {hasFilters && (
            <Link href="/ledger" className="btn-secondary">
              Clear
            </Link>
          )}
        </div>
      </form>

      <section className="card mb-5 grid overflow-hidden md:grid-cols-2 md:divide-x md:divide-line">
        <div className="bg-emerald-500/[0.06] px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Income</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-700 sm:text-3xl">{money(moneyIn)}</p>
          <p className="mt-1 text-xs text-slate-500">Payments received at sales and on debts</p>
        </div>
        <div className="border-t border-line bg-red-500/[0.06] px-5 py-4 md:border-t-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Expenses and money out</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-brand-red-dark sm:text-3xl">{money(moneyOut)}</p>
          <p className="mt-1 text-xs text-slate-500">Expenses, suppliers, refunds and what the owner took out</p>
        </div>
      </section>

      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon={<ScrollText size={22} />} title={hasFilters ? "No entries match your filters" : "No money has moved yet"} description={hasFilters ? "Try another period or clear the filters." : "Entries appear here when a sale is paid, a debt is collected, an expense or a supplier is paid, or cash goes to the bank."} />
        ) : (
          <>
            <div className={cn("hidden border-b border-line px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 lg:grid lg:items-center lg:gap-x-3", COLS)} aria-hidden>
              <span>Time</span>
              <span>What</span>
              <span>Type</span>
              <span>Account</span>
              <span>By</span>
              <span className="text-right">Out</span>
              <span className="text-right">In</span>
            </div>
            {days.map((d) => {
              const t = perDay.get(d);
              return (
                <section key={d} aria-label={dayTitle(d, today, yesterday)}>
                  <h2 className="flex items-center justify-between gap-3 border-b border-line bg-slate-50/90 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 sm:px-5">
                    <span>{dayTitle(d, today, yesterday)}</span>
                    <span className="normal-case tracking-normal">
                      in <span className="font-semibold text-emerald-700">{money(dec(t?.inn))}</span> · out <span className="font-semibold text-brand-red-dark">{money(dec(t?.out))}</span>
                    </span>
                  </h2>
                  <ul>
                    {rows
                      .filter((r) => (r as Row & { day: string }).day === d)
                      .map((r) => {
                        const amount = dec(r.amount);
                        const into = amount.gt(0);
                        const what = r.type === "SALE_PAYMENT" || r.type === "COLLECTION" ? (r.customerName ?? "Walk-in sale") : r.type === "EXPENSE" || r.type === "EXPENSE_REVERSAL" ? (r.expenseText ?? r.description ?? TX_LABEL[r.type]) : (r.description ?? TX_LABEL[r.type]);
                        const href = sourceHref(r.referenceType, r.referenceId);
                        return (
                          <li key={r.id} className={cn("grid grid-cols-2 items-center gap-x-3 gap-y-1.5 border-b border-line/70 px-4 py-3 last:border-b-0 sm:px-5", COLS)}>
                            <span className="text-xs tabular-nums text-slate-500 lg:text-sm">{timeOf(r.createdAt)}</span>
                            <span className="justify-self-end lg:hidden">
                              <span className={BADGE[r.type]}>{TX_LABEL[r.type]}</span>
                            </span>
                            <div className="col-span-2 min-w-0 lg:col-span-1">
                              <span className="block truncate text-sm font-medium text-slate-900">{what}</span>
                              <span className="block truncate text-xs text-slate-500">
                                {r.categoryName && <span className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{r.categoryName}</span>}
                                {href && r.referenceNo ? (
                                  <Link href={href} className="font-mono text-navy-700 hover:underline">
                                    {r.referenceNo}
                                  </Link>
                                ) : (
                                  <span className="font-mono">{r.referenceNo ?? ""}</span>
                                )}
                              </span>
                            </div>
                            <div className="hidden lg:block">
                              <span className={BADGE[r.type]}>{TX_LABEL[r.type]}</span>
                            </div>
                            <div className="col-span-2 min-w-0 lg:col-span-1">
                              <Link href={`/cash/${r.accountId}`} className="block truncate text-sm text-slate-800 hover:underline">
                                {r.accountName}
                              </Link>
                              {r.accountNumber && <span className="block truncate text-xs text-slate-500">{r.accountNumber}</span>}
                            </div>
                            <div className="col-span-2 min-w-0 truncate text-sm text-slate-600 lg:col-span-1">
                              <span className="text-xs text-slate-500 lg:hidden">By </span>
                              {r.userName}
                            </div>
                            <div className="flex items-center justify-between gap-2 lg:block lg:text-right">
                              <span className="inline-flex items-center gap-1 text-xs text-slate-500 lg:hidden">
                                <ArrowUpRight size={12} /> Out
                              </span>
                              <span className={cn("text-sm font-semibold tabular-nums", into ? "text-slate-300" : "text-brand-red-dark")}>{into ? "—" : money(amount.abs())}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2 lg:block lg:text-right">
                              <span className="inline-flex items-center gap-1 text-xs text-slate-500 lg:hidden">
                                <ArrowDownLeft size={12} /> In
                              </span>
                              <span className={cn("text-sm font-semibold tabular-nums", into ? "text-emerald-700" : "text-slate-300")}>{into ? money(amount) : "—"}</span>
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
    </>
  );
}
