import Link from "next/link";
import { Package, Plus, Search } from "lucide-react";
import { EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { can } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { formatMoney } from "@/lib/money";
import { getCurrency } from "@/lib/settings";

export const metadata = { title: "Products" };

const PAGE_SIZE = 25;

type Search = { q?: string; category?: string; status?: string; page?: string };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePagePermission("products.view");
  const sp = await searchParams;
  const currency = await getCurrency();
  const canCost = can(user, "products.cost");

  const q = sp.q?.trim() ?? "";
  const status = sp.status === "inactive" ? "INACTIVE" : sp.status === "all" ? undefined : "ACTIVE";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const where: Prisma.ProductWhereInput = {
    ...(status ? { status } : {}),
    ...(sp.category ? { categoryId: sp.category } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { sku: { contains: q, mode: "insensitive" } },
            { barcode: { contains: q } },
          ],
        }
      : {}),
  };

  const [products, total, categories] = await Promise.all([
    db.product.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { category: { select: { name: true } }, brand: { select: { name: true } }, baseUnit: { select: { symbol: true } } },
    }),
    db.product.count({ where }),
    db.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (sp.category) params.set("category", sp.category);
    if (sp.status) params.set("status", sp.status);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `/products?${s}` : "/products";
  };
  const hasFilters = Boolean(q || sp.category || (sp.status && sp.status !== "active"));

  return (
    <>
      <PageHeader
        title="Products"
        description="Everything you sell, with its units, prices and minimum stock level."
        actions={
          can(user, "products.create") && (
            <Link href="/products/new" className="btn-primary">
              <Plus size={16} /> Add product
            </Link>
          )
        }
      />

      <form className="card card-pad mb-4 grid gap-3 sm:grid-cols-[1fr_200px_160px_auto]" method="get">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input name="q" defaultValue={q} placeholder="Search name, SKU or barcode" className="input pl-9" aria-label="Search products" />
        </div>
        <select name="category" defaultValue={sp.category ?? ""} className="input" aria-label="Category">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
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
            <Link href="/products" className="btn-secondary">
              Clear
            </Link>
          )}
        </div>
      </form>

      <div className="card overflow-hidden">
        {products.length === 0 ? (
          <EmptyState
            icon={<Package size={22} />}
            title={hasFilters ? "No products match your filters" : "No products yet"}
            description={hasFilters ? "Try a different search or clear the filters." : "Add your first product to start recording stock and sales."}
            action={
              !hasFilters && can(user, "products.create") ? (
                <Link href="/products/new" className="btn-primary">
                  <Plus size={16} /> Add product
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="hidden sm:table-cell">Category</th>
                  <th className="hidden md:table-cell">Base unit</th>
                  <th className="text-right">Selling price</th>
                  {canCost && <th className="hidden text-right md:table-cell">Purchase price</th>}
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/products/${p.id}`} className="font-medium text-slate-900 hover:text-navy-700 hover:underline">
                        {p.name}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {p.sku}
                        {p.brand ? ` · ${p.brand.name}` : ""}
                      </p>
                    </td>
                    <td className="hidden sm:table-cell">{p.category.name}</td>
                    <td className="hidden md:table-cell">{p.baseUnit.symbol}</td>
                    <td className="text-right font-medium">{formatMoney(p.sellingPrice, currency)}</td>
                    {canCost && <td className="hidden text-right md:table-cell">{formatMoney(p.purchasePrice, currency)}</td>}
                    <td>
                      <StatusBadge status={p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-slate-600">
            <span>
              Page {page} of {pages} · {total} products
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link href={qs(page - 1)} className="btn-secondary btn-sm">
                  Previous
                </Link>
              )}
              {page < pages && (
                <Link href={qs(page + 1)} className="btn-secondary btn-sm">
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
