import Link from "next/link";
import { Clock, HandCoins, Handshake, Package, Plus, Search, UserCheck } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import KpiCard from "@/components/dashboard/KpiCard";
import WingaCard, { wingaStatus } from "@/components/resellers/WingaCard";
import { can } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { getResellerAccount } from "@/lib/resellers/engine";
import { emptyStanding, getStandings } from "@/lib/resellers/performance";
import { getCurrency } from "@/lib/settings";
import { cn, formatDate } from "@/lib/utils";

export const metadata = { title: "Winga" };

const FILTERS = [
  { key: "all", label: "All" },
  { key: "late", label: "Late" },
  { key: "owing", label: "Owe money" },
  { key: "stock", label: "Have stock" },
  { key: "settled", label: "Settled" },
  { key: "inactive", label: "Inactive" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

/** Winga (resellers) as cards: how well each one pays, what they hold and what they owe. Press a card for the full profile and performance. */
export default async function ResellersPage({ searchParams }: { searchParams: Promise<{ f?: string; q?: string }> }) {
  const user = await requirePagePermission("resellers.view");
  const sp = await searchParams;
  const currency = await getCurrency();
  const money = (v: Parameters<typeof formatMoney>[0]) => formatMoney(v, currency);
  const canManage = can(user, "resellers.manage");
  const f: FilterKey = FILTERS.some((x) => x.key === sp.f) ? (sp.f as FilterKey) : "all";
  const q = sp.q?.trim().toLowerCase() ?? "";

  const resellers = await db.reseller.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }] });
  const [accounts, standings] = await Promise.all([Promise.all(resellers.map((r) => getResellerAccount(db, r.id))), getStandings(db)]);

  const rows = accounts.map((a) => {
    const st = standings.get(a.reseller.id) ?? emptyStanding;
    const status = wingaStatus({ inactive: a.reseller.status === "INACTIVE", lateInvoices: st.lateInvoices, openInvoices: st.openInvoices, holdsStock: a.remainingQty.gt(0), reports: a.reports });
    return { a, st, status };
  });
  const sum = (g: (x: (typeof rows)[number]) => number) => rows.reduce((s, x) => s + g(x), 0);
  const active = rows.filter((x) => x.a.reseller.status === "ACTIVE");
  const lateWinga = rows.filter((x) => x.st.lateInvoices > 0 && x.a.reseller.status === "ACTIVE");
  const counts: Record<FilterKey, number> = { all: rows.length, late: lateWinga.length, owing: rows.filter((x) => x.a.outstanding.gt(0)).length, stock: rows.filter((x) => x.a.remainingQty.gt(0)).length, settled: rows.filter((x) => x.status.key === "settled").length, inactive: rows.filter((x) => x.status.key === "inactive").length };
  // overall: of every invoice that is settled or late, how many were paid by the due date
  const onTimeAll = (() => {
    let ok = 0;
    let of = 0;
    for (const x of rows) {
      if (x.st.onTimePct !== null) {
        ok += Math.round((x.st.onTimePct / 100) * x.st.onTimeOf);
        of += x.st.onTimeOf;
      }
    }
    return of > 0 ? Math.round((ok / of) * 100) : null;
  })();

  const shown = rows
    .filter((x) => (f === "all" ? true : f === "late" ? x.st.lateInvoices > 0 : f === "owing" ? x.a.outstanding.gt(0) : f === "stock" ? x.a.remainingQty.gt(0) : x.status.key === f))
    .filter((x) => !q || [x.a.reseller.name, x.a.reseller.businessName, x.a.reseller.phone, x.a.reseller.salesLocation].filter(Boolean).join(" ").toLowerCase().includes(q))
    .sort((p, r) => Number(r.st.lateInvoices > 0) - Number(p.st.lateInvoices > 0) || r.a.outstanding.comparedTo(p.a.outstanding) || p.a.reseller.name.localeCompare(r.a.reseller.name));

  const href = (key: FilterKey) => `/resellers${key === "all" && !q ? "" : `?${new URLSearchParams({ ...(key !== "all" ? { f: key } : {}), ...(q ? { q: sp.q!.trim() } : {}) }).toString()}`}`;

  return (
    <>
      <PageHeader
        title="Winga"
        description="People who take our stock to sell elsewhere. Stock they hold is still ours: it is off the shop shelf but counted under their name until it is sold or returned."
        actions={
          canManage && (
            <Link href="/resellers/new" className="btn-primary">
              <Plus size={16} /> Register winga
            </Link>
          )
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard icon={UserCheck} tone="navy" label="Winga" value={active.length} hint={`${rows.length} registered`} />
        <KpiCard icon={Package} tone="blue" label="Stock with winga" value={money(sum((x) => x.a.remainingValue.toNumber()))} hint="At the agreed prices" />
        <KpiCard icon={HandCoins} tone="yellow" label="Owed by winga" value={money(sum((x) => x.a.outstanding.toNumber()))} hint={onTimeAll === null ? "For what they reported sold" : `${onTimeAll}% of invoices paid on time`} />
        <KpiCard icon={Clock} tone={sum((x) => x.a.overdue.toNumber()) > 0 ? "red" : "green"} label="Late" value={money(sum((x) => x.a.overdue.toNumber()))} hint={lateWinga.length > 0 ? `${lateWinga.length} winga past the payment date` : "Nobody is late"} href={lateWinga.length > 0 ? href("late") : undefined} active={f === "late"} />
      </div>

      {rows.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Handshake size={22} />}
            title="No winga yet"
            description="Register a winga, then issue stock to them. Everything they take, sell and pay is tracked here."
            action={
              canManage ? (
                <Link href="/resellers/new" className="btn-primary">
                  Register winga
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <nav className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="Winga filters">
              {FILTERS.filter((x) => x.key === "all" || x.key === f || counts[x.key] > 0).map((x) => {
                const active = f === x.key;
                return (
                  <Link key={x.key} href={href(x.key)} aria-current={active ? "page" : undefined} className={cn("inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition", active ? "border-navy-700 bg-navy-700 text-white" : "border-line bg-white text-slate-600 hover:border-navy-200 hover:text-slate-900")}>
                    {x.label}
                    <span className={cn("rounded-full px-1.5 text-xs font-semibold", active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600")}>{counts[x.key]}</span>
                  </Link>
                );
              })}
            </nav>
            <form method="get" action="/resellers" className="relative w-full sm:w-72">
              {f !== "all" && <input type="hidden" name="f" value={f} />}
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input name="q" defaultValue={sp.q ?? ""} placeholder="Name, shop or phone" className="input pl-9" aria-label="Search winga" />
            </form>
          </div>

          {shown.length === 0 ? (
            <div className="card">
              <EmptyState icon={<Handshake size={22} />} title="No winga match" description="Try another filter or clear the search." />
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {shown.map(({ a, st, status }) => (
                <WingaCard
                  key={a.reseller.id}
                  href={`/resellers/${a.reseller.id}`}
                  name={a.reseller.name}
                  subtitle={[a.reseller.businessName, a.reseller.phone, a.reseller.salesLocation].filter(Boolean).join(" · ")}
                  status={status}
                  onTimePct={st.onTimePct}
                  onTimeOf={st.onTimeOf}
                  stockValue={money(a.remainingValue)}
                  stockItems={`${a.remainingQty.toString()} item${a.remainingQty.eq(1) ? "" : "s"} with them`}
                  owes={a.outstanding.gt(0) ? money(a.outstanding) : "Owes nothing"}
                  owesTone={a.overdue.gt(0) ? "red" : a.outstanding.gt(0) ? "normal" : "muted"}
                  owesHint={a.overdue.gt(0) ? `Oldest ${st.oldestLateDays ?? 0} day${st.oldestLateDays === 1 ? "" : "s"} late` : a.outstanding.gt(0) ? (st.nextDueDays === null ? "Open invoices" : st.nextDueDays === 0 ? "Next payment due today" : `Next payment due in ${st.nextDueDays} day${st.nextDueDays === 1 ? "" : "s"}`) : a.reports > 0 ? "All paid up" : "Nothing reported yet"}
                  footer={`Reported sold ${money(a.soldValue)} · ${a.lastPaymentAt ? `last payment ${formatDate(a.lastPaymentAt)}` : "no payment yet"}`}
                />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
