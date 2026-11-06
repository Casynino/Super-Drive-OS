import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Banknote, ChevronRight, Landmark, Plus, Smartphone, Star, Wallet } from "lucide-react";
import { AddAccountForm } from "@/components/cash/AccountAdmin";
import KpiCard from "@/components/dashboard/KpiCard";
import { Alert, PageHeader } from "@/components/ui";
import { Prisma, type PaymentMethod } from "@/generated/prisma/client";
import { can } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { defaultLocationId, getAccountBalances } from "@/lib/cash/ledger";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { getCurrency } from "@/lib/settings";
import { cn } from "@/lib/utils";

export const metadata = { title: "Cash & Accounts" };

const ICON: Record<PaymentMethod, typeof Banknote> = { CASH: Banknote, MOBILE_MONEY: Smartphone, BANK: Landmark };
const KIND: Record<PaymentMethod, string> = { CASH: "The till", MOBILE_MONEY: "Mobile money", BANK: "Bank" };

/** Cash & Accounts: only the accounts. Press one to see its own balance and every movement of money in and out of it. */
export default async function CashPage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const user = await requirePagePermission("cash.view");
  const sp = await searchParams;
  if (sp.account) redirect(`/cash/${sp.account}`); // older links to one account's entries
  const currency = await getCurrency();
  const money = (v: Prisma.Decimal | string) => formatMoney(v, currency);
  const locationId = await defaultLocationId(db);
  const canAdjust = can(user, "cash.adjust");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(new Date());

  const [accounts, closings, openedTill, unclosed] = await Promise.all([
    getAccountBalances(db, locationId),
    db.dailyClosing.count({ where: { locationId } }),
    db.cashTransaction.count({ where: { type: "OPENING_BALANCE", account: { locationId, method: "CASH" } } }),
    db.cashTransaction.count({ where: { account: { locationId }, closingId: null, businessDate: { lt: new Date(`${today}T00:00:00Z`) } } }),
  ]);
  const noStart = openedTill === 0 && closings === 0;
  const sum = (m?: PaymentMethod) => accounts.filter((a) => !m || a.method === m).reduce((s, a) => s.plus(a.balance), new Prisma.Decimal(0));
  const count = (m: PaymentMethod) => accounts.filter((a) => a.method === m && a.status === "ACTIVE").length;

  return (
    <>
      <PageHeader
        title="Cash & Accounts"
        description="Where the money is. Press an account to see its balance and every movement of money in and out of it: each balance is the total of its own entries, so it can always be traced."
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

      {noStart && (
        <div className="mb-4">
          <Alert kind="info">
            <span className="flex items-start gap-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>
                <strong>Record how much cash is in the till today</strong> before the shop starts closing days. Open the Cash account and use &ldquo;Record an entry&rdquo; with &ldquo;Opening balance&rdquo;. Without it, the first closing will show the starting cash as a surplus.
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

      <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard icon={Wallet} tone="navy" label="In all accounts" value={money(sum())} hint={`${accounts.filter((a) => a.status === "ACTIVE").length} accounts`} />
        <KpiCard icon={Banknote} tone="yellow" label="Cash" value={money(sum("CASH"))} hint="The till" />
        <KpiCard icon={Smartphone} tone="green" label="Mobile money" value={money(sum("MOBILE_MONEY"))} hint={`${count("MOBILE_MONEY")} account${count("MOBILE_MONEY") === 1 ? "" : "s"}`} />
        <KpiCard icon={Landmark} tone="blue" label="Banks" value={money(sum("BANK"))} hint={`${count("BANK")} account${count("BANK") === 1 ? "" : "s"}`} />
      </div>

      <div className="mb-5 grid gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3">
        {accounts.map((a) => {
          const Icon = ICON[a.method];
          const closed = a.status !== "ACTIVE";
          return (
            <Link key={a.id} href={`/cash/${a.id}`} className={cn("card group flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:border-navy-200 hover:shadow-md", closed && "opacity-70")}>
              <div className="card-pad flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-slate-900">
                      {a.name}
                      {a.isDefault && a.method !== "CASH" && (
                        <span className="badge-blue inline-flex items-center gap-1">
                          <Star size={11} /> Main
                        </span>
                      )}
                      {closed && <span className="badge-gray">Closed</span>}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {KIND[a.method]}
                      {a.accountNumber ? ` · ${a.accountNumber}` : ""}
                    </p>
                    {a.holderName && <p className="truncate text-xs text-slate-500">{a.holderName}</p>}
                  </div>
                  <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", a.method === "CASH" ? "bg-oil-soft text-yellow-800" : a.method === "BANK" ? "bg-navy-50 text-navy-700" : "bg-emerald-50 text-emerald-700")}>
                    <Icon size={18} />
                  </span>
                </div>
                <p className={cn("mt-3 text-2xl font-semibold tracking-tight", a.balance.lt(0) ? "text-brand-red-dark" : "text-slate-900")}>{money(a.balance)}</p>
                <p className="mt-2 flex flex-wrap gap-x-4 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <ArrowDownLeft size={13} className="text-emerald-600" /> In today {money(a.inToday)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <ArrowUpRight size={13} className="text-brand-red" /> Out today {money(a.outToday)}
                  </span>
                </p>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-line bg-slate-50/60 px-4 py-2.5 text-xs font-medium text-navy-700 group-hover:text-navy-900">
                <span>
                  View transactions ({a.movements})
                </span>
                <ChevronRight size={15} className="transition group-hover:translate-x-0.5" />
              </div>
            </Link>
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
    </>
  );
}
