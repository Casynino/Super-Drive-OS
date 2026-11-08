import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { AlertTriangle, ArrowDownLeft, ArrowLeft, ArrowUpRight, Banknote, ChevronLeft, ChevronRight, Landmark, ListOrdered, Smartphone, Star, Wallet } from "lucide-react";
import { AccountOpButton, EditAccountForm } from "@/components/cash/AccountAdmin";
import { ManualCashForm } from "@/components/cash/CashForms";
import KpiCard from "@/components/dashboard/KpiCard";
import KpiStrip from "@/components/dashboard/KpiStrip";
import { Alert, EmptyState } from "@/components/ui";
import { Prisma, type CashTxType, type PaymentMethod } from "@/generated/prisma/client";
import { can } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { TX_LABEL, defaultLocationId, getAccountBalances } from "@/lib/cash/ledger";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { getCurrency } from "@/lib/settings";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { manualCashAction } from "../actions";

export const metadata = { title: "Account" };

const PAGE_SIZE = 40;
type Search = { type?: string; from?: string; to?: string; page?: string; done?: string };
const isDate = (s?: string) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));
const ICON: Record<PaymentMethod, typeof Banknote> = { CASH: Banknote, MOBILE_MONEY: Smartphone, BANK: Landmark };
const KIND: Record<PaymentMethod, string> = { CASH: "The till", MOBILE_MONEY: "Mobile money", BANK: "Bank" };

type Row = { id: string; createdAt: Date; businessDate: Date; type: CashTxType; amount: Prisma.Decimal | string; referenceNo: string | null; description: string | null; closingId: string | null; userName: string; balance: Prisma.Decimal | string };

/** One account (the till, M-PESA, CRDB, NMB...): its own balance and every movement of money in and out of it, with the balance after each one. */
export default async function CashAccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const user = await requirePagePermission("cash.view");
  const { id } = await params;
  const sp = await searchParams;
  const currency = await getCurrency();
  const money = (v: Prisma.Decimal | string) => formatMoney(v, currency);
  const locationId = await defaultLocationId(db);
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const canAdjust = can(user, "cash.adjust");

  const [balances, closings, opening] = await Promise.all([
    getAccountBalances(db, locationId),
    db.dailyClosing.count({ where: { locationId } }),
    db.cashTransaction.findFirst({ where: { accountId: id, type: "OPENING_BALANCE" }, select: { id: true } }),
  ]);
  const a = balances.find((b) => b.id === id);
  if (!a) notFound();

  const type = sp.type && sp.type in TX_LABEL ? (sp.type as CashTxType) : undefined;
  const conds: Prisma.Sql[] = [];
  if (type) conds.push(Prisma.sql`q."type" = ${type}::"CashTxType"`);
  if (isDate(sp.from)) conds.push(Prisma.sql`q."businessDate" >= ${sp.from}::date`);
  if (isDate(sp.to)) conds.push(Prisma.sql`q."businessDate" <= ${sp.to}::date`);
  const where = conds.length ? Prisma.sql`WHERE ${Prisma.join(conds, " AND ")}` : Prisma.empty;
  // every row of this account with the balance after it, then the filter and the page (so "balance after" is right even when filtered)
  const inner = Prisma.sql`
    SELECT t."id", t."createdAt", t."businessDate", t."type", t."amount", t."referenceNo", t."description", t."closingId", u."name" AS "userName",
           SUM(t."amount") OVER (ORDER BY t."createdAt", t."id") AS "balance"
      FROM "CashTransaction" t JOIN "User" u ON u."id" = t."userId" WHERE t."accountId" = ${id}`;
  const [rows, sums] = await Promise.all([
    db.$queryRaw<Row[]>`SELECT q.* FROM (${inner}) q ${where} ORDER BY q."createdAt" DESC, q."id" DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
    db.$queryRaw<{ n: bigint; inn: Prisma.Decimal | null; out: Prisma.Decimal | null }[]>`
      SELECT COUNT(*) AS n, SUM(q."amount") FILTER (WHERE q."amount" > 0) AS inn, SUM(-q."amount") FILTER (WHERE q."amount" < 0) AS out FROM (${inner}) q ${where}`,
  ]);
  const total = Number(sums[0]?.n ?? 0);
  const filteredIn = new Prisma.Decimal(sums[0]?.inn ?? 0);
  const filteredOut = new Prisma.Decimal(sums[0]?.out ?? 0);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(type || sp.from || sp.to);
  const noStart = !opening && (a.method === "CASH" ? closings === 0 : a.movements === 0);
  const closed = a.status !== "ACTIVE";
  const Icon = ICON[a.method];
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ type: sp.type, from: sp.from, to: sp.to })) if (v) q.set(k, v);
    if (p > 1) q.set("page", String(p));
    return `/cash/${id}${q.size ? `?${q.toString()}` : ""}`;
  };

  return (
    <>
      <Link href="/cash" className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900">
        <ArrowLeft size={15} /> All accounts
      </Link>

      <section className={cn("card mb-5 p-4 sm:p-5", closed && "opacity-80")}>
        <div className="flex flex-wrap items-start gap-4">
          <span className={cn("grid h-14 w-14 shrink-0 place-items-center rounded-2xl", a.method === "CASH" ? "bg-oil-soft text-yellow-800" : a.method === "BANK" ? "bg-navy-50 text-navy-700" : "bg-emerald-50 text-emerald-700")}>
            <Icon size={26} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{a.name}</h1>
              {a.isDefault && a.method !== "CASH" && (
                <span className="badge-blue inline-flex items-center gap-1">
                  <Star size={11} /> Main
                </span>
              )}
              {closed && <span className="badge-gray">Closed</span>}
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {KIND[a.method]}
              {a.accountNumber && <> · <span className="font-mono text-slate-700">{a.accountNumber}</span></>}
              {a.holderName && <> · {a.holderName}</>}
            </p>
          </div>
          {canAdjust && a.method !== "CASH" && (
            <div className="flex flex-wrap items-start gap-2">
              {!closed && !a.isDefault && <AccountOpButton id={a.id} op="default">Make main</AccountOpButton>}
              {!closed && !a.isDefault && <AccountOpButton id={a.id} op="close" danger>Close account</AccountOpButton>}
              {closed && <AccountOpButton id={a.id} op="reopen">Open again</AccountOpButton>}
            </div>
          )}
        </div>
      </section>

      {sp.done && (
        <div className="mb-4">
          <Alert kind="success">Saved. The new entry is at the top of the list.</Alert>
        </div>
      )}
      {noStart && (
        <div className="mb-4">
          <Alert kind="info">
            <span className="flex items-start gap-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>
                <strong>No money has been recorded in {a.name} yet.</strong> If money is already there, record how much with &ldquo;Record an entry&rdquo; below and choose &ldquo;Opening balance&rdquo;.{a.method === "CASH" ? " Without it, the first closing will show the starting cash as a surplus." : ""}
              </span>
            </span>
          </Alert>
        </div>
      )}

      <KpiStrip className="mb-5">
        <KpiCard icon={Wallet} tone={a.balance.lt(0) ? "red" : "navy"} label="Balance now" value={money(a.balance)} hint="The total of every entry below" />
        <KpiCard icon={ArrowDownLeft} tone="green" label="In today" value={money(a.inToday)} />
        <KpiCard icon={ArrowUpRight} tone="red" label="Out today" value={money(a.outToday)} />
        <KpiCard icon={ListOrdered} tone="slate" label="Entries" value={a.movements} hint={a.lastAt ? `Last one ${formatDateTime(a.lastAt)}` : "Nothing yet"} />
      </KpiStrip>

      {canAdjust && (
        <div className="mb-5 grid gap-3 lg:grid-cols-2">
          <details className="card group" open={noStart || undefined}>
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3.5 text-base font-semibold text-slate-900 sm:px-5">
              Record an entry
              <span className="text-sm font-normal text-slate-500 group-open:hidden">Opening balance, withdrawal or correction</span>
            </summary>
            <div className="border-t border-line px-4 py-4 sm:px-5">
              <ManualCashForm action={manualCashAction} submissionKey={randomUUID()} openingDone={{ [a.id]: Boolean(opening) }} accounts={[{ id: a.id, name: a.name, accountNumber: a.accountNumber, method: a.method }]} />
            </div>
          </details>
          <details className="card group">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3.5 text-base font-semibold text-slate-900 sm:px-5">
              Edit this account
              <span className="text-sm font-normal text-slate-500 group-open:hidden">Name, number, holder</span>
            </summary>
            <div className="border-t border-line px-4 py-4 sm:px-5">
              <EditAccountForm id={a.id} name={a.name} accountNumber={a.accountNumber} holderName={a.holderName} />
            </div>
          </details>
        </div>
      )}

      <form method="get" className="card card-pad mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr_auto]">
        <select name="type" defaultValue={sp.type ?? ""} className="input" aria-label="Type">
          <option value="">All kinds of entries</option>
          {Object.entries(TX_LABEL).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <input type="date" name="from" defaultValue={sp.from ?? ""} className="input" aria-label="From date" />
        <input type="date" name="to" defaultValue={sp.to ?? ""} className="input" aria-label="To date" />
        <div className="flex gap-2">
          <button className="btn-primary" type="submit">
            Filter
          </button>
          {hasFilters && (
            <Link href={`/cash/${id}`} className="btn-secondary">
              Clear
            </Link>
          )}
        </div>
      </form>

      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon={<Banknote size={22} />} title={hasFilters ? "No entries match your filters" : "No money has moved in this account yet"} description={hasFilters ? undefined : "Entries appear here when a sale is paid into it, a debt is collected, an expense or a supplier is paid from it, or money is moved."} />
        ) : (
          <>
            {hasFilters && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-slate-50/60 px-4 py-2.5 text-sm text-slate-600 sm:px-5">
                <span>
                  {total} entr{total === 1 ? "y" : "ies"} in this view
                </span>
                <span>
                  In <span className="font-semibold text-emerald-700">{money(filteredIn)}</span> · out <span className="font-semibold text-brand-red-dark">{money(filteredOut)}</span>
                </span>
              </div>
            )}
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>What</th>
                    <th className="hidden md:table-cell">Reference</th>
                    <th className="hidden lg:table-cell">By</th>
                    <th className="text-right">Amount</th>
                    <th className="hidden text-right sm:table-cell">Balance after</th>
                    <th className="hidden sm:table-cell">Closed</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const amount = new Prisma.Decimal(r.amount.toString());
                    return (
                      <tr key={r.id}>
                        <td className="whitespace-nowrap text-slate-600">
                          {formatDateTime(r.createdAt)}
                          <span className="block text-xs text-slate-400">Day {formatDate(r.businessDate)}</span>
                        </td>
                        <td>
                          {TX_LABEL[r.type]}
                          {r.description && <span className="block max-w-[320px] truncate text-xs text-slate-500">{r.description}</span>}
                        </td>
                        <td className="hidden text-slate-500 md:table-cell">{r.referenceNo ?? "—"}</td>
                        <td className="hidden lg:table-cell">{r.userName}</td>
                        <td className={cn("whitespace-nowrap text-right font-medium tabular-nums", amount.gt(0) ? "text-emerald-700" : "text-brand-red-dark")}>
                          {amount.gt(0) ? "+" : "−"} {money(amount.abs())}
                        </td>
                        <td className="hidden whitespace-nowrap text-right tabular-nums text-slate-700 sm:table-cell">{money(r.balance)}</td>
                        <td className="hidden sm:table-cell">{r.closingId ? <Link href={`/closing/${r.closingId}`} className="text-xs text-navy-700 hover:underline">Closed</Link> : <span className="text-xs text-slate-400">Open</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm sm:px-5">
            <span className="text-slate-500">
              Page {page} of {pages} · {total} entries
            </span>
            <span className="flex gap-2">
              {page > 1 && (
                <Link href={href(page - 1)} className="btn-secondary !px-3 !py-1.5">
                  <ChevronLeft size={15} /> Newer
                </Link>
              )}
              {page < pages && (
                <Link href={href(page + 1)} className="btn-secondary !px-3 !py-1.5">
                  Older <ChevronRight size={15} />
                </Link>
              )}
            </span>
          </div>
        )}
      </div>
    </>
  );
}
