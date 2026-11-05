import Link from "next/link";
import { Plus, Search, Users } from "lucide-react";
import { EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { Prisma, type CustomerType } from "@/generated/prisma/client";
import { can } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { outstandingByCustomer } from "@/lib/sales/outstanding";
import { getCurrency } from "@/lib/settings";
import { CUSTOMER_TYPES, customerTypeLabel } from "./types";

export const metadata = { title: "Customers" };

const PAGE_SIZE = 25;
type Search = { q?: string; type?: string; status?: string; page?: string };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePagePermission("customers.view");
  const sp = await searchParams;
  const currency = await getCurrency();
  const showCredit = can(user, "credit.view");
  const q = sp.q?.trim() ?? "";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const status = sp.status === "inactive" ? "INACTIVE" : sp.status === "all" ? undefined : "ACTIVE";
  const type = CUSTOMER_TYPES.find((t) => t.value === sp.type)?.value as CustomerType | undefined;

  const where: Prisma.CustomerWhereInput = {
    ...(status ? { status } : {}),
    ...(type ? { type } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { contactPerson: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const [customers, total, owed] = await Promise.all([
    db.customer.findMany({ where, orderBy: { name: "asc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db.customer.count({ where }),
    showCredit ? outstandingByCustomer(db) : new Map<string, Prisma.Decimal>(),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(q || type || (sp.status && sp.status !== "active"));
  const href = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, type: sp.type, status: sp.status })) if (v) params.set(k, v);
    if (p > 1) params.set("page", String(p));
    return `/customers?${params.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Customers"
        description="Register a customer once and reuse them on every sale."
        actions={
          can(user, "customers.create") && (
            <Link href="/customers/new" className="btn-primary">
              <Plus size={16} /> Add customer
            </Link>
          )
        }
      />

      <form method="get" className="card card-pad mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_auto]">
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
        <div className="flex gap-2">
          <button className="btn-primary" type="submit">
            Filter
          </button>
          {hasFilters && (
            <Link href="/customers" className="btn-secondary">
              Clear
            </Link>
          )}
        </div>
      </form>

      <div className="card overflow-hidden">
        {customers.length === 0 ? (
          <EmptyState icon={<Users size={22} />} title={hasFilters ? "No customers match your filters" : "No customers yet"} description={hasFilters ? undefined : "Add customers to link sales to them and to sell on credit."} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th className="hidden sm:table-cell">Type</th>
                  <th className="hidden md:table-cell">Phone</th>
                  {showCredit && <th className="hidden text-right md:table-cell">Credit limit</th>}
                  {showCredit && <th className="text-right">Owes</th>}
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => {
                  const owes = owed.get(c.id);
                  return (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/customers/${c.id}`} className="font-medium text-slate-900 hover:text-navy-700 hover:underline">
                          {c.name}
                        </Link>
                        {c.contactPerson && <span className="block text-xs text-slate-500">{c.contactPerson}</span>}
                      </td>
                      <td className="hidden sm:table-cell">
                        <span className="badge-blue">{customerTypeLabel(c.type)}</span>
                      </td>
                      <td className="hidden text-slate-600 md:table-cell">{c.phone ?? "—"}</td>
                      {showCredit && <td className="hidden text-right md:table-cell">{c.creditLimit.gt(0) ? formatMoney(c.creditLimit, currency) : <span className="text-slate-400">No credit</span>}</td>}
                      {showCredit && <td className={`text-right font-medium ${owes ? "text-brand-red-dark" : "text-slate-500"}`}>{owes ? formatMoney(owes, currency) : "—"}</td>}
                      <td>
                        <StatusBadge status={c.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-slate-600">
            <span>
              Page {page} of {pages} · {total} customers
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
