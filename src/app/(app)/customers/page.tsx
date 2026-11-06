import Link from "next/link";
import { AlertTriangle, HandCoins, LayoutGrid, Plus, Rows3, Search, Users } from "lucide-react";
import CustomerCard, { CUSTOMER_BADGE, pctTone } from "@/components/customers/CustomerCard";
import KpiCard from "@/components/dashboard/KpiCard";
import { EmptyState, PageHeader } from "@/components/ui";
import { Prisma, type CustomerType } from "@/generated/prisma/client";
import { can } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { customerStatus, emptyLifetime, getCustomerLifetimes, getCustomerStandings } from "@/lib/customers/performance";
import { emptyStanding } from "@/lib/resellers/performance";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { outstandingByCustomer } from "@/lib/sales/outstanding";
import { getCurrency } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { CUSTOMER_TYPES, customerTypeLabel } from "./types";

export const metadata = { title: "Customers" };

type Search = { q?: string; type?: string; status?: string; show?: string; sort?: string; view?: string; page?: string };
const SORTS = [
  { key: "attention", label: "Needs attention first" },
  { key: "name", label: "Name" },
  { key: "owes", label: "Owes most" },
  { key: "bought", label: "Bought most" },
] as const;

const daysAgoText = (d: Date | null) => {
  if (!d) return "Has not bought yet";
  const n = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  return n <= 0 ? "Last bought today" : n === 1 ? "Last bought yesterday" : `Last bought ${n} days ago`;
};

/** Customers: cards with how each one pays, what they bought and owe, and a button to collect a payment (or top up in advance) right there. */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePagePermission("customers.view");
  const sp = await searchParams;
  const currency = await getCurrency();
  const m = (v: Prisma.Decimal | number | string) => formatMoney(v, currency);
  const showCredit = can(user, "credit.view");
  const seeSales = can(user, "sales.view_all");
  const canCollect = can(user, "payments.record");
  const q = sp.q?.trim() ?? "";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const status = sp.status === "inactive" ? "INACTIVE" : sp.status === "all" ? undefined : "ACTIVE";
  const type = CUSTOMER_TYPES.find((t) => t.value === sp.type)?.value as CustomerType | undefined;
  const show = showCredit && (sp.show === "owe" || sp.show === "late") ? sp.show : undefined;
  const sort = SORTS.find((s) => s.key === sp.sort)?.key ?? "attention";
  // many customers: a compact table is the usual view, the cards are one press away
  const view = sp.view === "cards" ? "cards" : "table";
  const PAGE_SIZE = view === "cards" ? 24 : 30;

  const where: Prisma.CustomerWhereInput = {
    ...(status ? { status } : {}),
    ...(type ? { type } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { contactPerson: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const [customers, activeCount, owed, standings, lifetimes] = await Promise.all([
    db.customer.findMany({ where, orderBy: { name: "asc" } }),
    db.customer.count({ where: { status: "ACTIVE" } }),
    showCredit ? outstandingByCustomer(db) : new Map<string, Prisma.Decimal>(),
    showCredit ? getCustomerStandings(db) : new Map(),
    seeSales ? getCustomerLifetimes(db) : new Map(),
  ]);

  const rows = customers.map((c) => {
    const owes = owed.get(c.id) ?? new Prisma.Decimal(0);
    const st = standings.get(c.id) ?? emptyStanding;
    const lt = lifetimes.get(c.id) ?? emptyLifetime;
    return { c, owes, st, lt };
  });
  const owingCount = rows.filter((r) => r.owes.gt(0)).length;
  const lateCount = rows.filter((r) => r.st.lateInvoices > 0).length;
  const totalOwed = [...owed.values()].reduce((t, v) => t.plus(v), new Prisma.Decimal(0));
  const lateCustomersAll = [...standings.values()].filter((s) => s.lateInvoices > 0).length;

  const shown = rows
    .filter((r) => (show === "owe" ? r.owes.gt(0) : show === "late" ? r.st.lateInvoices > 0 : true))
    .sort((a, b) => {
      if (sort === "name") return a.c.name.localeCompare(b.c.name);
      if (sort === "owes") return b.owes.comparedTo(a.owes) || a.c.name.localeCompare(b.c.name);
      if (sort === "bought") return b.lt.bought.comparedTo(a.lt.bought) || a.c.name.localeCompare(b.c.name);
      return Number(b.st.lateInvoices > 0) - Number(a.st.lateInvoices > 0) || b.owes.comparedTo(a.owes) || a.c.name.localeCompare(b.c.name);
    });
  const total = shown.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageRows = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hasFilters = Boolean(q || type || show || (sp.status && sp.status !== "active") || (sp.sort && sp.sort !== "attention"));

  const link = (over: Partial<Search>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, type: sp.type, status: sp.status, show: sp.show, sort: sp.sort, view: sp.view, ...over })) if (v) params.set(k, v);
    const qs = params.toString();
    return `/customers${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Customers"
        description="Everyone who buys from you. Press a customer for their full picture."
        actions={
          can(user, "customers.create") && (
            <Link href="/customers/new" className="btn-primary">
              <Plus size={16} /> Add customer
            </Link>
          )
        }
      />

      <div className="mb-5 grid gap-3 sm:gap-4 [grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))]">
        <KpiCard icon={Users} tone="navy" label="Customers" value={String(activeCount)} hint="Active" />
        {showCredit && <KpiCard icon={HandCoins} tone={totalOwed.gt(0) ? "yellow" : "slate"} label="Owe us" value={m(totalOwed)} hint={`${owed.size} customer${owed.size === 1 ? "" : "s"} with an unpaid balance`} href={link({ show: "owe", page: undefined })} active={show === "owe"} />}
        {showCredit && <KpiCard icon={AlertTriangle} tone={lateCustomersAll > 0 ? "red" : "green"} label="Paying late" value={String(lateCustomersAll)} hint={lateCustomersAll > 0 ? "Past the due date: send a reminder" : "Nobody is late"} href={lateCustomersAll > 0 ? link({ show: "late", page: undefined }) : undefined} active={show === "late"} />}
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        {showCredit ? (
          <nav className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="Show">
            {([[undefined, "All", rows.length], ["owe", "Owe money", owingCount], ["late", "Late", lateCount]] as const).map(([k, label, n]) => (
              <Link key={label} href={link({ show: k, page: undefined })} aria-current={show === k ? "page" : undefined} className={cn("inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition", show === k ? "border-navy-700 bg-navy-700 text-white" : "border-line bg-white text-slate-600 hover:border-navy-200 hover:text-slate-900")}>
                {label}
                <span className={cn("rounded-full px-1.5 text-xs font-semibold", show === k ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600")}>{n}</span>
              </Link>
            ))}
          </nav>
        ) : (
          <span />
        )}
        <nav className="inline-flex rounded-xl border border-line bg-white p-0.5 text-sm font-medium" aria-label="View">
          {([["table", "Table", Rows3], ["cards", "Cards", LayoutGrid]] as const).map(([k, label, Icon]) => (
            <Link key={k} href={link({ view: k === "table" ? undefined : k, page: undefined })} aria-current={view === k ? "page" : undefined} className={cn("inline-flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 transition", view === k ? "bg-navy-700 text-white" : "text-slate-600 hover:bg-slate-100")}>
              <Icon size={14} /> {label}
            </Link>
          ))}
        </nav>
      </div>

      <form method="get" className="card card-pad mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr_auto_auto]">
        {show && <input type="hidden" name="show" value={show} />}
        {view === "cards" && <input type="hidden" name="view" value="cards" />}
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input name="q" defaultValue={q} placeholder="Search name, phone or contact" className="input pl-9" aria-label="Search customers" />
        </div>
        <select name="type" defaultValue={sp.type ?? ""} className="input" aria-label="Customer type">
          <option value="">All types</option>
          {CUSTOMER_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={sp.status ?? "active"} className="input" aria-label="Status">
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
        <select name="sort" defaultValue={sort} className="input" aria-label="Sort">
          {SORTS.filter((s) => (s.key !== "owes" || showCredit) && (s.key !== "bought" || seeSales)).map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <button className="btn-primary" type="submit">
          Apply
        </button>
        {hasFilters ? (
          <Link href="/customers" className="btn-secondary">
            Clear
          </Link>
        ) : (
          <span className="hidden lg:block" />
        )}
      </form>

      {pageRows.length === 0 ? (
        <div className="card">
          <EmptyState icon={<Users size={22} />} title={hasFilters ? "No customers match your filters" : "No customers yet"} description={hasFilters ? undefined : "Add customers to link sales to them and to sell on credit."} />
        </div>
      ) : view === "table" ? (
        <div className="card overflow-hidden">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th className="hidden sm:table-cell">Type</th>
                  <th className="hidden md:table-cell">Phone</th>
                  {showCredit && <th className="hidden text-right md:table-cell">Credit limit</th>}
                  {showCredit && <th className="text-right">Owes</th>}
                  {showCredit && <th className="hidden text-right lg:table-cell">Pays on time</th>}
                  <th>Status</th>
                  {canCollect && <th aria-label="Action" />}
                </tr>
              </thead>
              <tbody>
                {pageRows.map(({ c, owes, st, lt }) => {
                  const known = showCredit || seeSales;
                  const stat = known ? customerStatus({ inactive: c.status === "INACTIVE", lateInvoices: st.lateInvoices, openInvoices: st.openInvoices, orders: seeSales ? lt.orders : 1 }) : { label: c.status === "ACTIVE" ? "Active" : "Inactive", tone: "slate" as const };
                  return (
                    <tr key={c.id}>
                      <td className={cn("border-l-[3px]", stat.tone === "red" ? "border-l-brand-red" : stat.tone === "yellow" ? "border-l-oil-400" : "border-l-transparent")}>
                        <Link href={`/customers/${c.id}`} className="font-medium text-slate-900 hover:text-navy-700 hover:underline">
                          {c.name}
                        </Link>
                        {c.contactPerson && <span className="block text-xs text-slate-500">{c.contactPerson}</span>}
                      </td>
                      <td className="hidden sm:table-cell">
                        <span className="badge-blue">{customerTypeLabel(c.type)}</span>
                      </td>
                      <td className="hidden text-slate-600 md:table-cell">{c.phone ?? "—"}</td>
                      {showCredit && <td className="hidden text-right md:table-cell">{c.creditLimit.gt(0) ? m(c.creditLimit) : <span className="text-slate-400">No credit</span>}</td>}
                      {showCredit && (
                        <td className={cn("text-right font-medium", st.lateInvoices > 0 ? "text-brand-red-dark" : owes.gt(0) ? "text-slate-900" : "text-slate-400")}>
                          {owes.gt(0) ? m(owes) : "—"}
                          {st.lateInvoices > 0 && <span className="block text-xs font-normal">oldest {st.oldestLateDays ?? 0} days late</span>}
                        </td>
                      )}
                      {showCredit && <td className={cn("hidden text-right font-semibold tabular-nums lg:table-cell", st.onTimePct === null ? "text-slate-300" : pctTone(st.onTimePct))}>{st.onTimePct === null ? "—" : `${st.onTimePct}%`}</td>}
                      <td>
                        <span className={CUSTOMER_BADGE[stat.tone]}>{stat.label}</span>
                      </td>
                      {canCollect && (
                        <td className="text-right">
                          {(owes.gt(0) || c.status === "ACTIVE") && (
                            <Link href={`/customers/${c.id}/pay`} className={owes.gt(0) ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>
                              {owes.gt(0) ? "Collect" : "Top up"}
                            </Link>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
          {pageRows.map(({ c, owes, st, lt }) => {
            const known = showCredit || seeSales;
            const stat = known ? customerStatus({ inactive: c.status === "INACTIVE", lateInvoices: st.lateInvoices, openInvoices: st.openInvoices, orders: seeSales ? lt.orders : 1 }) : { label: c.status === "ACTIVE" ? "Active" : "Inactive", tone: "slate" as const };
            const owesHint = owes.gt(0)
              ? st.lateInvoices > 0
                ? `${st.lateInvoices} late · oldest ${st.oldestLateDays ?? 0} day${st.oldestLateDays === 1 ? "" : "s"}`
                : st.nextDueDays !== null
                  ? `Next payment due ${st.nextDueDays === 0 ? "today" : `in ${st.nextDueDays} day${st.nextDueDays === 1 ? "" : "s"}`}`
                  : "Unpaid balance"
              : c.creditLimit.gt(0)
                ? `Credit limit ${m(c.creditLimit)}`
                : "Pays at the sale";
            return (
              <CustomerCard
                key={c.id}
                href={`/customers/${c.id}`}
                name={c.name}
                subtitle={`${customerTypeLabel(c.type)} · ${c.phone ?? "no phone yet"}`}
                status={stat}
                onTimePct={st.onTimePct}
                onTimeOf={st.onTimeOf}
                left={seeSales ? { value: m(lt.bought), hint: `${lt.orders} order${lt.orders === 1 ? "" : "s"} bought` } : null}
                right={showCredit ? { value: owes.gt(0) ? m(owes) : "—", hint: owesHint, tone: st.lateInvoices > 0 ? "red" : owes.gt(0) ? "normal" : "muted" } : null}
                footer={seeSales ? daysAgoText(lt.lastAt) : (c.contactPerson ?? "")}
                action={canCollect && (owes.gt(0) || c.status === "ACTIVE") ? { href: `/customers/${c.id}/pay`, label: owes.gt(0) ? "Collect payment" : "Top up", primary: owes.gt(0) } : null}
              />
            );
          })}
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-line bg-white px-4 py-3 text-sm text-slate-600">
          <span>
            Page {page} of {pages} · {total} customers
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={link({ page: String(page - 1) })} className="btn-secondary btn-sm">
                Previous
              </Link>
            )}
            {page < pages && (
              <Link href={link({ page: String(page + 1) })} className="btn-secondary btn-sm">
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </>
  );
}
