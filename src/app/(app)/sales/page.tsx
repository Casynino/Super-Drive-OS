import Link from "next/link";
import { Plus, Receipt, Search } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { Prisma, type PaymentStatus } from "@/generated/prisma/client";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { getCurrency } from "@/lib/settings";
import { formatDateTime } from "@/lib/utils";
import { PaymentStatusBadge } from "./StatusBadge";

export const metadata = { title: "Sales history" };

const PAGE_SIZE = 25;
type Search = { q?: string; customer?: string; status?: string; seller?: string; from?: string; to?: string; page?: string };
const isDate = (s?: string) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));
const STATUS: Record<string, PaymentStatus> = { paid: "PAID", partial: "PARTIALLY_PAID", unpaid: "UNPAID" };

export default async function SalesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  if (!canAny(user, ["sales.view_own", "sales.view_all"])) redirect("/forbidden");
  const viewAll = can(user, "sales.view_all");
  const sp = await searchParams;
  const currency = await getCurrency();
  const q = sp.q?.trim() ?? "";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const createdAt: Prisma.DateTimeFilter = {};
  if (isDate(sp.from)) createdAt.gte = new Date(`${sp.from}T00:00:00+03:00`);
  if (isDate(sp.to)) createdAt.lte = new Date(`${sp.to}T23:59:59.999+03:00`);

  const where: Prisma.SaleWhereInput = {
    // Without "view all sales", people only ever see the sales they made themselves.
    ...(viewAll ? (sp.seller ? { salespersonId: sp.seller } : {}) : { salespersonId: user.id }),
    ...(sp.customer ? { customerId: sp.customer } : {}),
    ...(STATUS[sp.status ?? ""] ? { paymentStatus: STATUS[sp.status!] } : {}),
    ...(Object.keys(createdAt).length ? { createdAt } : {}),
    ...(q ? { OR: [{ saleNo: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }] } : {}),
  };

  const [sales, total, totals, sellers] = await Promise.all([
    db.sale.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { customer: { select: { name: true } }, salesperson: { select: { name: true } } },
    }),
    db.sale.count({ where }),
    db.sale.aggregate({ where, _sum: { total: true, amountPaid: true } }),
    viewAll ? db.user.findMany({ where: { sales: { some: {} } }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
  ]);

  const sumTotal = totals._sum.total ?? new Prisma.Decimal(0);
  const sumPaid = totals._sum.amountPaid ?? new Prisma.Decimal(0);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(q || sp.customer || sp.status || sp.seller || sp.from || sp.to);
  const href = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, customer: sp.customer, status: sp.status, seller: sp.seller, from: sp.from, to: sp.to })) if (v) params.set(k, v);
    if (p > 1) params.set("page", String(p));
    return `/sales?${params.toString()}`;
  };

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

      <form method="get" className="card card-pad mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {sp.customer && <input type="hidden" name="customer" value={sp.customer} />}
        <div className="relative sm:col-span-2">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input name="q" defaultValue={q} placeholder="Invoice no. or customer" className="input pl-9" aria-label="Search sales" />
        </div>
        <select name="status" defaultValue={sp.status ?? ""} className="input" aria-label="Payment status">
          <option value="">Any payment status</option>
          <option value="paid">Paid</option>
          <option value="partial">Part paid</option>
          <option value="unpaid">Unpaid</option>
        </select>
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
        <div className="flex gap-2 sm:col-span-2 lg:col-span-6">
          <button className="btn-primary" type="submit">
            Filter
          </button>
          {hasFilters && (
            <Link href="/sales" className="btn-secondary">
              Clear
            </Link>
          )}
        </div>
      </form>

      <div className="card overflow-hidden">
        {sales.length === 0 ? (
          <EmptyState icon={<Receipt size={22} />} title={hasFilters ? "No sales match your filters" : "No sales yet"} description={hasFilters ? undefined : "Sales appear here as soon as they are completed in the POS."} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>When</th>
                    <th className="hidden sm:table-cell">Customer</th>
                    {viewAll && <th className="hidden lg:table-cell">Sold by</th>}
                    <th className="text-right">Total</th>
                    <th className="hidden text-right md:table-cell">Paid</th>
                    <th className="hidden text-right md:table-cell">Balance</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((s) => {
                    const balance = s.total.minus(s.amountPaid);
                    return (
                      <tr key={s.id}>
                        <td>
                          <Link href={`/sales/${s.id}`} className="font-medium text-navy-700 hover:underline">
                            {s.saleNo}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap text-slate-600">{formatDateTime(s.createdAt)}</td>
                        <td className="hidden sm:table-cell">{s.customer?.name ?? <span className="text-slate-400">Walk-in</span>}</td>
                        {viewAll && <td className="hidden text-slate-600 lg:table-cell">{s.salesperson.name}</td>}
                        <td className="text-right font-medium">{formatMoney(s.total, currency)}</td>
                        <td className="hidden text-right md:table-cell">{formatMoney(s.amountPaid, currency)}</td>
                        <td className={`hidden text-right md:table-cell ${balance.gt(0) ? "font-medium text-brand-red-dark" : "text-slate-400"}`}>{balance.gt(0) ? formatMoney(balance, currency) : "—"}</td>
                        <td>
                          <PaymentStatusBadge status={s.paymentStatus} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-slate-50 px-4 py-3 text-sm">
              <span className="text-slate-600">
                {total} sale{total === 1 ? "" : "s"} in this view
              </span>
              <span className="font-medium text-slate-900">
                Total {formatMoney(sumTotal, currency)} · Paid {formatMoney(sumPaid, currency)} · Unpaid {formatMoney(sumTotal.minus(sumPaid), currency)}
              </span>
            </div>
          </>
        )}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-slate-600">
            <span>
              Page {page} of {pages}
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
