import Link from "next/link";
import { ArrowLeftRight, Search } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { Prisma, type StockMovementType } from "@/generated/prisma/client";
import { can } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { MOVEMENT_LABELS, documentHref } from "@/lib/inventory/labels";
import { formatMoney } from "@/lib/money";
import { getCurrency } from "@/lib/settings";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Stock movements" };

const PAGE_SIZE = 50;
type Search = { q?: string; location?: string; type?: string; from?: string; to?: string; page?: string };
const isDate = (s?: string) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));

export default async function MovementsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePagePermission("inventory.movements");
  const sp = await searchParams;
  const currency = await getCurrency();
  const showCost = can(user, "inventory.valuation");
  const q = sp.q?.trim() ?? "";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const type = sp.type && sp.type in MOVEMENT_LABELS ? (sp.type as StockMovementType) : undefined;

  // Business time zone is UTC+3 all year, so day boundaries are fixed.
  const createdAt: Prisma.DateTimeFilter = {};
  if (isDate(sp.from)) createdAt.gte = new Date(`${sp.from}T00:00:00+03:00`);
  if (isDate(sp.to)) createdAt.lte = new Date(`${sp.to}T23:59:59.999+03:00`);

  const where: Prisma.StockMovementWhereInput = {
    ...(sp.location ? { locationId: sp.location } : {}),
    ...(type ? { type } : {}),
    ...(Object.keys(createdAt).length ? { createdAt } : {}),
    ...(q ? { OR: [{ product: { name: { contains: q, mode: "insensitive" } } }, { product: { sku: { contains: q, mode: "insensitive" } } }, { referenceNo: { contains: q, mode: "insensitive" } }] } : {}),
  };

  const [rows, total, locations] = await Promise.all([
    db.stockMovement.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { product: { select: { name: true, sku: true, baseUnit: { select: { symbol: true } } } }, location: { select: { name: true } }, user: { select: { name: true } } },
    }),
    db.stockMovement.count({ where }),
    db.location.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(q || sp.location || type || sp.from || sp.to);
  const href = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, location: sp.location, type: sp.type, from: sp.from, to: sp.to })) if (v) params.set(k, v);
    if (p > 1) params.set("page", String(p));
    return `/inventory/movements?${params.toString()}`;
  };

  return (
    <>
      <PageHeader title="Stock movements" description="The complete ledger: every change to stock, with the quantity before and after, who did it and why." />

      <form method="get" className="card card-pad mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_auto_auto_auto]">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input name="q" defaultValue={q} placeholder="Product, SKU or document no." className="input pl-9" aria-label="Search" />
        </div>
        <select name="location" defaultValue={sp.location ?? ""} className="input" aria-label="Location">
          <option value="">All locations</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <select name="type" defaultValue={sp.type ?? ""} className="input" aria-label="Movement type">
          <option value="">All types</option>
          {Object.entries(MOVEMENT_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
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
            <Link href="/inventory/movements" className="btn-secondary">
              Clear
            </Link>
          )}
        </div>
      </form>

      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon={<ArrowLeftRight size={22} />} title={hasFilters ? "No movements match your filters" : "No stock movements yet"} description={hasFilters ? undefined : "Movements appear as soon as stock is received, sold, transferred or adjusted."} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Product</th>
                  <th className="hidden sm:table-cell">Location</th>
                  <th>Type</th>
                  <th className="text-right">Change</th>
                  <th className="hidden text-right md:table-cell">Before → after</th>
                  {showCost && <th className="hidden text-right lg:table-cell">Unit cost</th>}
                  <th className="hidden lg:table-cell">Document</th>
                  <th className="hidden xl:table-cell">By</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const t = MOVEMENT_LABELS[m.type]!;
                  const neg = m.quantity.isNegative();
                  const link = documentHref(m.referenceType, m.referenceId);
                  return (
                    <tr key={m.id}>
                      <td className="whitespace-nowrap text-slate-600">{formatDateTime(m.createdAt)}</td>
                      <td>
                        <span className="font-medium">{m.product.name}</span>
                        <span className="block text-xs text-slate-500">{m.product.sku}</span>
                      </td>
                      <td className="hidden sm:table-cell">{m.location.name}</td>
                      <td>
                        <span className={t.badge}>{t.label}</span>
                        {m.reason && <span className="mt-0.5 block max-w-[14rem] truncate text-xs text-slate-500">{m.reason}</span>}
                      </td>
                      <td className={`whitespace-nowrap text-right font-semibold ${neg ? "text-brand-red-dark" : "text-emerald-700"}`}>
                        {neg ? "" : "+"}
                        {m.quantity.toString()} {m.product.baseUnit.symbol}
                      </td>
                      <td className="hidden whitespace-nowrap text-right text-slate-600 md:table-cell">
                        {m.previousQty.toString()} → {m.newQty.toString()}
                      </td>
                      {showCost && <td className="hidden text-right lg:table-cell">{m.unitCost ? formatMoney(m.unitCost, { ...currency, decimals: Math.max(currency.decimals, 2) }) : "—"}</td>}
                      <td className="hidden lg:table-cell">
                        {link ? (
                          <Link href={link} className="text-navy-700 hover:underline">
                            {m.referenceNo}
                          </Link>
                        ) : (
                          (m.referenceNo ?? "—")
                        )}
                      </td>
                      <td className="hidden text-slate-600 xl:table-cell">{m.user.name}</td>
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
              Page {page} of {pages} · {total} movements
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
