import Link from "next/link";
import { Search, Wallet } from "lucide-react";
import { EmptyState, PageHeader, Stat } from "@/components/ui";
import { Prisma, type PaymentMethod, type PaymentSource } from "@/generated/prisma/client";
import { canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { methodLabel } from "@/lib/sales/types";
import { getCurrency } from "@/lib/settings";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Payments" };

const PAGE_SIZE = 30;
type Search = { q?: string; method?: string; source?: string; from?: string; to?: string; page?: string };
const isDate = (s?: string) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));
const METHODS: PaymentMethod[] = ["CASH", "MOBILE_MONEY", "BANK"];
const SOURCES: PaymentSource[] = ["AT_SALE", "DEBT_COLLECTION"];

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  if (!canAny(user, ["payments.view"])) redirect("/forbidden");
  const sp = await searchParams;
  const currency = await getCurrency();
  const q = sp.q?.trim() ?? "";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const receivedAt: Prisma.DateTimeFilter = {};
  if (isDate(sp.from)) receivedAt.gte = new Date(`${sp.from}T00:00:00+03:00`);
  if (isDate(sp.to)) receivedAt.lte = new Date(`${sp.to}T23:59:59.999+03:00`);
  const where: Prisma.PaymentWhereInput = {
    ...(METHODS.includes(sp.method as PaymentMethod) ? { method: sp.method as PaymentMethod } : {}),
    ...(SOURCES.includes(sp.source as PaymentSource) ? { source: sp.source as PaymentSource } : {}),
    ...(Object.keys(receivedAt).length ? { receivedAt } : {}),
    ...(q ? { OR: [{ paymentNo: { contains: q, mode: "insensitive" } }, { reference: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }] } : {}),
  };

  const [rows, total, byMethod] = await Promise.all([
    db.payment.findMany({
      where,
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { customer: { select: { name: true } }, receivedBy: { select: { name: true } } },
    }),
    db.payment.count({ where }),
    db.payment.groupBy({ by: ["method"], where, _sum: { amount: true } }),
  ]);
  const sum = (m: PaymentMethod) => byMethod.find((b) => b.method === m)?._sum.amount ?? new Prisma.Decimal(0);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(q || sp.method || sp.source || sp.from || sp.to);
  const href = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, method: sp.method, source: sp.source, from: sp.from, to: sp.to })) if (v) params.set(k, v);
    if (p > 1) params.set("page", String(p));
    return `/payments?${params.toString()}`;
  };

  return (
    <>
      <PageHeader title="Payments" description="Money received: paid at the time of sale, or collected later against credit invoices. Payments are never counted as new sales." />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        {METHODS.map((m) => (
          <Stat key={m} label={methodLabel(m)} value={formatMoney(sum(m), currency)} hint="In this view" />
        ))}
      </div>

      <form method="get" className="card card-pad mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_auto]">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input name="q" defaultValue={q} placeholder="Payment no., customer, reference" className="input pl-9" aria-label="Search payments" />
        </div>
        <select name="method" defaultValue={sp.method ?? ""} className="input" aria-label="Method">
          <option value="">All methods</option>
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {methodLabel(m)}
            </option>
          ))}
        </select>
        <select name="source" defaultValue={sp.source ?? ""} className="input" aria-label="Type">
          <option value="">All types</option>
          <option value="AT_SALE">Paid at sale</option>
          <option value="DEBT_COLLECTION">Debt collection</option>
        </select>
        <input type="date" name="from" defaultValue={sp.from ?? ""} className="input" aria-label="From date" />
        <input type="date" name="to" defaultValue={sp.to ?? ""} className="input" aria-label="To date" />
        <div className="flex gap-2">
          <button className="btn-primary" type="submit">
            Filter
          </button>
          {hasFilters && (
            <Link href="/payments" className="btn-secondary">
              Clear
            </Link>
          )}
        </div>
      </form>

      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon={<Wallet size={22} />} title={hasFilters ? "No payments match your filters" : "No payments yet"} description={hasFilters ? undefined : "Payments appear here when a sale is paid or a customer settles a debt."} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Payment</th>
                  <th>When</th>
                  <th className="hidden sm:table-cell">Customer</th>
                  <th>Method</th>
                  <th className="hidden md:table-cell">Type</th>
                  <th className="text-right">Amount</th>
                  <th className="hidden lg:table-cell">Received by</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/payments/${p.id}`} className="font-medium text-navy-700 hover:underline">
                        {p.paymentNo}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap text-slate-600">{formatDateTime(p.receivedAt)}</td>
                    <td className="hidden sm:table-cell">{p.customer?.name ?? <span className="text-slate-400">Walk-in</span>}</td>
                    <td>{methodLabel(p.method)}</td>
                    <td className="hidden md:table-cell">{p.source === "AT_SALE" ? <span className="badge-blue">Paid at sale</span> : <span className="badge-green">Debt collection</span>}</td>
                    <td className="text-right font-semibold">{formatMoney(p.amount, currency)}</td>
                    <td className="hidden text-slate-600 lg:table-cell">{p.receivedBy.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-slate-600">
            <span>
              Page {page} of {pages} · {total} payments
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
