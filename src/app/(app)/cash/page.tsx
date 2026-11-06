import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Banknote, ChevronRight, Landmark, Plus, Smartphone, Star, Wallet } from "lucide-react";
import { Alert, PageHeader } from "@/components/ui";
import { Prisma } from "@/generated/prisma/client";
import { can } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { defaultLocationId, getAccountBalances } from "@/lib/cash/ledger";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { getCurrency } from "@/lib/settings";
import { cn } from "@/lib/utils";

export const metadata = { title: "Accounts" };

const GROUPS = [
  { method: "CASH", title: "Cash", icon: Banknote, tint: "bg-oil-soft text-yellow-800" },
  { method: "MOBILE_MONEY", title: "Mobile money", icon: Smartphone, tint: "bg-emerald-50 text-emerald-700" },
  { method: "BANK", title: "Banks", icon: Landmark, tint: "bg-navy-50 text-navy-700" },
] as const;

const XL_COLS = { 1: "xl:grid-cols-1", 2: "xl:grid-cols-2", 3: "xl:grid-cols-3", 4: "xl:grid-cols-4" } as const;
const XL_SPAN = { 1: "xl:col-span-1", 2: "xl:col-span-2", 3: "xl:col-span-3", 4: "xl:col-span-4" } as const;

/** Cash & Accounts: only the accounts. Press one to see its own balance and every movement of money in and out of it. */
export default async function CashPage({ searchParams }: { searchParams: Promise<{ account?: string; moved?: string }> }) {
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
  // Cards per row on a wide screen, chosen so rows fill up: 4 accounts make one row of 4, 6 make two rows of 3, and
  // whatever is left over in the last row is taken by the last card (never an empty gap).
  const n = accounts.length;
  const xl = Math.min(4, Math.max(1, n <= 4 ? n : n % 3 === 0 ? 3 : 4)) as 1 | 2 | 3 | 4;
  const xlLeft = (xl - (n % xl || xl) + 1) as 1 | 2 | 3 | 4; // columns the last card spans
  const sum = () => accounts.reduce((s, a) => s.plus(a.balance), new Prisma.Decimal(0));

  return (
    <>
      <PageHeader
        title="Accounts"
        description="Where the money is. Press an account to see its entries."
        actions={
          <>
            {canAdjust && (
              <Link href="/cash/new" className="btn-primary">
                <Plus size={16} /> Add account
              </Link>
            )}
            {canAdjust && (
              <Link href="/cash/move" className="btn-secondary">
                <ArrowLeftRight size={16} /> Move money
              </Link>
            )}
            <Link href="/closing" className="btn-secondary">
              End of day
            </Link>
          </>
        }
      />

      {sp.moved && (
        <div className="mb-4">
          <Alert kind="success">{sp.moved}</Alert>
        </div>
      )}
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

      <section className="card mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-4">
        <div className="flex items-center gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-navy-50 text-navy-700">
            <Wallet size={24} />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">All money</p>
            <p className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{money(sum())}</p>
          </div>
        </div>
        <p className="text-sm text-slate-500">in {accounts.filter((a) => a.status === "ACTIVE").length} accounts</p>
      </section>

      <div className={cn("mb-5 grid gap-3 sm:gap-4 md:grid-cols-2", XL_COLS[xl])}>
        {accounts.map((a, i) => {
          const g = GROUPS.find((x) => x.method === a.method)!;
          const last = i === accounts.length - 1;
          const closed = a.status !== "ACTIVE";
          return (
            <Link key={a.id} href={`/cash/${a.id}`} className={cn("card group flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:border-navy-200 hover:shadow-md", closed && "opacity-70", last && accounts.length % 2 === 1 && "md:col-span-2", last && XL_SPAN[xlLeft])}>
              <div className="card-pad flex-1">
                <div className="flex items-start justify-between gap-3">
                  <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl", g.tint)}>
                    <g.icon size={20} />
                  </span>
                  <span className="flex flex-wrap items-center justify-end gap-1.5">
                    {a.isDefault && a.method !== "CASH" && (
                      <span className="badge-blue inline-flex items-center gap-1">
                        <Star size={11} /> Main
                      </span>
                    )}
                    {closed && <span className="badge-gray">Closed</span>}
                    <span className="badge-gray">{a.method === "CASH" ? "Cash" : g.title === "Banks" ? "Bank" : g.title}</span>
                  </span>
                </div>
                <p className="mt-3 truncate text-base font-semibold text-slate-900">{a.name}</p>
                <p className="mt-0.5 min-h-[2.1rem] text-xs text-slate-500">
                  {a.method === "CASH" ? "The till" : a.accountNumber ? <span className="font-mono text-slate-600">{a.accountNumber}</span> : "No number yet"}
                  {a.holderName && <span className="block truncate">{a.holderName}</span>}
                </p>
                <p className={cn("mt-3 text-2xl font-bold tracking-tight", a.balance.lt(0) ? "text-brand-red-dark" : "text-slate-900")}>{money(a.balance)}</p>
                <p className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <ArrowDownLeft size={13} className="text-emerald-600" /> In today {money(a.inToday)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <ArrowUpRight size={13} className="text-brand-red" /> Out today {money(a.outToday)}
                  </span>
                </p>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-line bg-slate-50/60 px-4 py-2.5 text-xs font-medium text-navy-700 group-hover:text-navy-900">
                <span>View transactions ({a.movements})</span>
                <ChevronRight size={15} className="transition group-hover:translate-x-0.5" />
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
