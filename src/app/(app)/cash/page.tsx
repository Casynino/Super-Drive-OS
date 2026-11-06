import Link from "next/link";
import { randomUUID } from "node:crypto";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Banknote, Landmark, Plus, Smartphone, Star } from "lucide-react";
import { AccountOpButton, AddAccountForm, EditAccountForm } from "@/components/cash/AccountAdmin";
import { ManualCashForm } from "@/components/cash/CashForms";
import { Alert, EmptyState, PageHeader } from "@/components/ui";
import { Prisma, type CashTxType, type PaymentMethod } from "@/generated/prisma/client";
import { can } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { METHODS, TX_LABEL, defaultLocationId, getAccountBalances, listAccounts } from "@/lib/cash/ledger";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { getCurrency } from "@/lib/settings";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { manualCashAction } from "./actions";

export const metadata = { title: "Cash & Accounts" };

const PAGE_SIZE = 40;
type Search = { account?: string; method?: string; type?: string; from?: string; to?: string; page?: string; done?: string };
const isDate = (s?: string) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));
const ICON: Record<PaymentMethod, typeof Banknote> = { CASH: Banknote, MOBILE_MONEY: Smartphone, BANK: Landmark };

export default async function CashPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePagePermission("cash.view");
  const sp = await searchParams;
  const currency = await getCurrency();
  const locationId = await defaultLocationId(db);
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const canAdjust = can(user, "cash.adjust");

  const businessDate: Prisma.DateTimeFilter = {};
  if (isDate(sp.from)) businessDate.gte = new Date(`${sp.from}T00:00:00Z`);
  if (isDate(sp.to)) businessDate.lte = new Date(`${sp.to}T00:00:00Z`);
  const where: Prisma.CashTransactionWhereInput = {
    account: { locationId, ...(sp.account ? { id: sp.account } : METHODS.includes(sp.method as PaymentMethod) ? { method: sp.method as PaymentMethod } : {}) },
    ...(sp.type && sp.type in TX_LABEL ? { type: sp.type as CashTxType } : {}),
    ...(Object.keys(businessDate).length ? { businessDate } : {}),
  };

  const [balances, openAccounts, rows, total, openings, closings, unclosed] = await Promise.all([
    getAccountBalances(db, locationId),
    listAccounts(db, locationId),
    db.cashTransaction.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { account: { select: { method: true, name: true, accountNumber: true } }, user: { select: { name: true } } } }),
    db.cashTransaction.count({ where }),
    db.cashTransaction.findMany({ where: { type: "OPENING_BALANCE", account: { locationId } }, select: { accountId: true } }),
    db.dailyClosing.count({ where: { locationId } }),
    db.cashTransaction.count({ where: { account: { locationId }, closingId: null, businessDate: { lt: new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(new Date())}T00:00:00Z`) } } }),
  ]);
  const openingDone = Object.fromEntries(balances.map((a) => [a.id, openings.some((o) => o.accountId === a.id)]));
  const till = balances.find((a) => a.method === "CASH");
  const noStart = Boolean(till && !openingDone[till.id]) && closings === 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(sp.account || sp.method || sp.type || sp.from || sp.to);
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ account: sp.account, method: sp.method, type: sp.type, from: sp.from, to: sp.to })) if (v) q.set(k, v);
    if (p > 1) q.set("page", String(p));
    return `/cash?${q.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Cash & Accounts"
        description="Where the money is: cash in the till, mobile money and the bank. Every balance is the total of the entries below, so it can always be traced."
        actions={
          <>
            <Link href="/closing" className="btn-secondary">
              Daily closings
            </Link>
            <Link href="/deposits" className="btn-secondary">
              Bank deposits
            </Link>
          </>
        }
      />

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
                <strong>Record how much cash is in the till today</strong> before the shop starts closing days. Use &ldquo;Record an entry&rdquo; below and choose &ldquo;Opening balance&rdquo;. Without it, the first closing will show the starting cash as a surplus.
              </span>
            </span>
          </Alert>
        </div>
      )}
      {unclosed > 0 && (
        <div className="mb-4">
          <Alert kind="info">There are cash entries from earlier days that no closing has taken yet. They will be included in the next closing.</Alert>
        </div>
      )}

      <div className="mb-5 grid gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3">
        {balances.map((b) => {
          const Icon = ICON[b.method];
          const closed = b.status !== "ACTIVE";
          return (
            <div key={b.id} className={cn("card flex flex-col overflow-hidden", closed && "opacity-70")}>
              <div className="card-pad flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-slate-900">
                      {b.name}
                      {b.isDefault && b.method !== "CASH" && (
                        <span className="badge-blue inline-flex items-center gap-1">
                          <Star size={11} /> Main
                        </span>
                      )}
                      {closed && <span className="badge-gray">Closed</span>}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {b.method === "CASH" ? "The till" : b.method === "BANK" ? "Bank" : "Mobile money"}
                      {b.accountNumber ? ` · ${b.accountNumber}` : ""}
                    </p>
                    {b.holderName && <p className="truncate text-xs text-slate-500">{b.holderName}</p>}
                  </div>
                  <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", b.method === "CASH" ? "bg-oil-soft text-yellow-800" : b.method === "BANK" ? "bg-navy-50 text-navy-700" : "bg-emerald-50 text-emerald-700")}>
                    <Icon size={18} />
                  </span>
                </div>
                <p className={cn("mt-3 text-2xl font-semibold tracking-tight", b.balance.lt(0) ? "text-brand-red-dark" : "text-slate-900")}>{formatMoney(b.balance, currency)}</p>
                <p className="mt-2 flex flex-wrap gap-x-4 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <ArrowDownLeft size={13} className="text-emerald-600" /> In today {formatMoney(b.inToday, currency)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <ArrowUpRight size={13} className="text-brand-red" /> Out today {formatMoney(b.outToday, currency)}
                  </span>
                </p>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-line bg-slate-50/60 px-4 py-2 text-xs">
                <Link href={`/cash?account=${b.id}`} className="font-medium text-navy-700 hover:underline">
                  See every entry ({b.movements})
                </Link>
                {canAdjust && (
                  <details className="group relative">
                    <summary className="cursor-pointer list-none font-medium text-slate-600 hover:text-slate-900">Manage</summary>
                    <div className="absolute bottom-full right-0 z-20 mb-2 w-72 space-y-3 rounded-xl border border-line bg-white p-4 shadow-xl">
                      <EditAccountForm id={b.id} name={b.name} accountNumber={b.accountNumber} holderName={b.holderName} />
                      {b.method !== "CASH" && (
                        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                          {!closed && !b.isDefault && <AccountOpButton id={b.id} op="default">Make main</AccountOpButton>}
                          {!closed && !b.isDefault && <AccountOpButton id={b.id} op="close" danger>Close</AccountOpButton>}
                          {closed && <AccountOpButton id={b.id} op="reopen">Open again</AccountOpButton>}
                        </div>
                      )}
                    </div>
                  </details>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {canAdjust && (
        <details className="card mb-5 group">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3.5 text-base font-semibold text-slate-900 sm:px-5">
            <span className="inline-flex items-center gap-2">
              <Plus size={17} /> Add an account
            </span>
            <span className="text-sm font-normal text-slate-500 group-open:hidden">CRDB, NMB, M-PESA, Lipa number...</span>
          </summary>
          <div className="border-t border-line px-4 py-4 sm:px-5">
            <p className="mb-3 text-sm text-slate-500">Every account you add can be chosen when selling, collecting a debt, paying an expense or a supplier. Its balance is the total of the money recorded in it.</p>
            <AddAccountForm />
          </div>
        </details>
      )}

      {canAdjust && (
        <details className="card mb-5 group" open={noStart || undefined}>
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3.5 text-base font-semibold text-slate-900 sm:px-5">
            Record an entry
            <span className="text-sm font-normal text-slate-500 group-open:hidden">Opening balance, withdrawal or correction</span>
          </summary>
          <div className="border-t border-line px-4 py-4 sm:px-5">
            <ManualCashForm action={manualCashAction} submissionKey={randomUUID()} openingDone={openingDone} accounts={openAccounts.map((a) => ({ id: a.id, name: a.name, accountNumber: a.accountNumber, method: a.method }))} />
          </div>
        </details>
      )}

      <form method="get" className="card card-pad mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto]">
        <select name="account" defaultValue={sp.account ?? ""} className="input" aria-label="Account">
          <option value="">All accounts</option>
          {balances.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.accountNumber ? ` · ${a.accountNumber}` : ""}
            </option>
          ))}
        </select>
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
            <Link href="/cash" className="btn-secondary">
              Clear
            </Link>
          )}
        </div>
      </form>

      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon={<Banknote size={22} />} title={hasFilters ? "No entries match your filters" : "No money has moved yet"} description={hasFilters ? undefined : "Entries appear here when a sale is paid, a debt is collected, an expense is paid or cash goes to the bank."} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Account</th>
                  <th>What</th>
                  <th className="hidden md:table-cell">Reference</th>
                  <th className="hidden lg:table-cell">By</th>
                  <th className="text-right">Amount</th>
                  <th className="hidden sm:table-cell">Closed</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap text-slate-600">
                      {formatDateTime(r.createdAt)}
                      <span className="block text-xs text-slate-400">Day {formatDate(r.businessDate)}</span>
                    </td>
                    <td>
                      {r.account.name}
                      {r.account.accountNumber && <span className="block text-xs text-slate-500">{r.account.accountNumber}</span>}
                    </td>
                    <td>
                      {TX_LABEL[r.type]}
                      {r.description && <span className="block max-w-[280px] truncate text-xs text-slate-500">{r.description}</span>}
                    </td>
                    <td className="hidden text-slate-500 md:table-cell">{r.referenceNo ?? "—"}</td>
                    <td className="hidden lg:table-cell">{r.user.name}</td>
                    <td className={cn("whitespace-nowrap text-right font-medium tabular-nums", r.amount.gt(0) ? "text-emerald-700" : "text-brand-red-dark")}>
                      {r.amount.gt(0) ? "+" : "−"} {formatMoney(r.amount.abs(), currency)}
                    </td>
                    <td className="hidden sm:table-cell">{r.closingId ? <Link href={`/closing/${r.closingId}`} className="text-xs text-navy-700 hover:underline">Closed</Link> : <span className="text-xs text-slate-400">Open</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-slate-600">
            <span>
              Page {page} of {pages} · {total} entries
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link href={href(page - 1)} className="btn-secondary btn-sm">
                  Previous
                </Link>
              )}
              {page < pages && (
                <Link href={href(page + 1)} className="btn-secondary btn-sm">
                  Next
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
