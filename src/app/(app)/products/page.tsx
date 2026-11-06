import Link from "next/link";
import { AlertTriangle, Boxes, Handshake, Package, PackageCheck, Plus, QrCode, Search, ShoppingCart } from "lucide-react";
import { EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import KpiCard from "@/components/dashboard/KpiCard";
import ProductLevelCard, { type ProductLevel } from "@/components/items/ProductLevelCard";
import LabelExistingStock from "@/components/products/LabelExistingStock";
import { can } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { LABELS_ENABLED, PIECE_LIST_ENABLED } from "@/lib/features";
import { untrackedStock } from "@/lib/inventory/items";
import { formatMoney } from "@/lib/money";
import { getCurrency } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { labelExistingStockAction } from "../items/actions";

export const metadata = { title: "Products" };

const PAGE_SIZE = 24;

type Search = { q?: string; category?: string; status?: string; page?: string; view?: string };

const num = (d: { toString(): string } | null | undefined) => Number(d?.toString() ?? 0);

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePagePermission("products.view");
  const sp = await searchParams;
  const currency = await getCurrency();
  const canCost = can(user, "products.cost");
  const canStock = can(user, "inventory.view");
  const view = sp.view === "table" ? "table" : "cards";

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
      include: { category: { select: { name: true } }, brand: { select: { name: true } }, baseUnit: { select: { symbol: true } }, image: { select: { updatedAt: true } } },
    }),
    db.product.count({ where }),
    db.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  // Where each product's pieces are: on the shelf, with resellers, sold, damaged (only for people who may see stock)
  const ids = products.map((p) => p.id);
  const [shelf, held, itemCounts, allBalances, untracked] = canStock
    ? await Promise.all([
        db.stockBalance.groupBy({ by: ["productId"], where: { productId: { in: ids }, location: { type: { not: "RESELLER" } } }, _sum: { quantity: true } }),
        db.stockBalance.groupBy({ by: ["productId"], where: { productId: { in: ids }, location: { type: "RESELLER" } }, _sum: { quantity: true } }),
        db.inventoryItem.groupBy({ by: ["productId", "status"], where: { productId: { in: ids }, status: { in: ["SOLD", "DAMAGED"] } }, _count: true }),
        // the whole catalogue, for the numbers on top
        db.stockBalance.groupBy({ by: ["productId", "locationId"], _sum: { quantity: true } }),
        can(user, "inventory.adjust") ? untrackedStock(db) : Promise.resolve([]),
      ])
    : [[], [], [], [], []];
  const shelfOf = new Map(shelf.map((r) => [r.productId, num(r._sum.quantity)]));
  const heldOf = new Map(held.map((r) => [r.productId, num(r._sum.quantity)]));
  const itemN = (id: string, s: "SOLD" | "DAMAGED") => itemCounts.find((r) => r.productId === id && r.status === s)?._count ?? 0;

  const levels: ProductLevel[] = products.map((p) => {
    const available = shelfOf.get(p.id) ?? 0;
    const reseller = heldOf.get(p.id) ?? 0;
    const sold = itemN(p.id, "SOLD");
    const damaged = itemN(p.id, "DAMAGED");
    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      imageV: p.image ? p.image.updatedAt.getTime() : null,
      minStock: num(p.minStock),
      available,
      reseller,
      sold,
      damaged,
      total: available + reseller + sold + damaged,
      subtitle: [p.category.name, p.brand?.name].filter(Boolean).join(" · "),
      price: formatMoney(p.sellingPrice, currency),
      inactive: p.status === "INACTIVE",
    };
  });

  // numbers on top: the whole catalogue, not just this page
  let top: { products: number; inShop: number; withResellers: number; sold: number; restock: number } | null = null;
  if (canStock) {
    const [catalogue, locations, soldTotal] = await Promise.all([
      db.product.findMany({ where: { status: "ACTIVE" }, select: { id: true, minStock: true } }),
      db.location.findMany({ select: { id: true, type: true } }),
      db.inventoryItem.count({ where: { status: "SOLD" } }),
    ]);
    const isReseller = new Set(locations.filter((l) => l.type === "RESELLER").map((l) => l.id));
    const onShelf = new Map<string, number>();
    let inShop = 0;
    let withResellers = 0;
    for (const b of allBalances) {
      const n = num(b._sum.quantity);
      if (isReseller.has(b.locationId)) withResellers += n;
      else {
        inShop += n;
        onShelf.set(b.productId, (onShelf.get(b.productId) ?? 0) + n);
      }
    }
    top = { products: catalogue.length, inShop, withResellers, sold: soldTotal, restock: catalogue.filter((c) => (onShelf.get(c.id) ?? 0) <= num(c.minStock)).length };
  }
  const missing = untracked.reduce((sum, r) => sum + r.missing, 0);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const link = (over: Partial<Search>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, category: sp.category, status: sp.status, view: sp.view, ...over })) if (v) params.set(k, String(v));
    const s = params.toString();
    return s ? `/products?${s}` : "/products";
  };
  const hasFilters = Boolean(q || sp.category || (sp.status && sp.status !== "active"));
  const n = (v: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v);

  return (
    <>
      <PageHeader
        title="Products"
        description="Everything you sell. Open a product to see its pieces, prices and codes."
        actions={
          <>
            {canStock && PIECE_LIST_ENABLED && (
              <Link href="/items" className="btn-secondary">
                <QrCode size={16} /> All pieces
              </Link>
            )}
            {can(user, "products.create") && (
              <Link href="/products/new" className="btn-primary">
                <Plus size={16} /> Add product
              </Link>
            )}
          </>
        }
      />

      {top && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-5">
          <KpiCard icon={Boxes} tone="navy" label="Products" value={n(top.products)} hint="Active, on sale" />
          <KpiCard icon={PackageCheck} tone="green" label="In the shop" value={n(top.inShop)} hint="Pieces on the shelf" />
          <KpiCard icon={Handshake} tone="blue" label="With resellers" value={n(top.withResellers)} hint="Held on trust" />
          <KpiCard icon={ShoppingCart} tone="slate" label="Sold" value={n(top.sold)} hint="Pieces sold so far" />
          <KpiCard icon={AlertTriangle} tone={top.restock > 0 ? "yellow" : "slate"} label="Restock" value={n(top.restock)} hint={top.restock > 0 ? "Low or out of stock" : "Nothing is low"} />
        </div>
      )}

      {LABELS_ENABLED && missing > 0 && <LabelExistingStock missing={missing} action={labelExistingStockAction} />}

      <form className="card card-pad mb-4 grid gap-3 sm:grid-cols-[1fr_200px_160px_auto]" method="get">
        {sp.view && <input type="hidden" name="view" value={sp.view} />}
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input name="q" defaultValue={q} placeholder="Search name, code or barcode" className="input pl-9" aria-label="Search products" />
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
            <Link href={link({ q: undefined, category: undefined, status: undefined, page: undefined })} className="btn-secondary">
              Clear
            </Link>
          )}
        </div>
      </form>

      <div className="mb-3 flex justify-end">
        <div className="inline-flex rounded-lg border border-line bg-white p-0.5 text-sm" role="group" aria-label="View">
          {[
            { key: "cards", label: "Cards" },
            { key: "table", label: "Table" },
          ].map((v) => (
            <Link key={v.key} href={link({ view: v.key === "cards" ? undefined : v.key, page: undefined })} aria-current={view === v.key ? "page" : undefined} className={cn("rounded-md px-3 py-1.5 font-medium transition", view === v.key ? "bg-navy-700 text-white" : "text-slate-600 hover:text-slate-900")}>
              {v.label}
            </Link>
          ))}
        </div>
      </div>

      {products.length === 0 ? (
        <div className="card overflow-hidden">
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
        </div>
      ) : view === "cards" ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {levels.map((l) => (
            <ProductLevelCard key={l.id} p={l} href={`/products/${l.id}`} showStock={canStock} />
          ))}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="hidden sm:table-cell">Category</th>
                  <th className="hidden md:table-cell">Base unit</th>
                  {canStock && <th className="text-right">In the shop</th>}
                  <th className="text-right">Selling price</th>
                  {canCost && <th className="hidden text-right md:table-cell">Purchase price</th>}
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p, i) => (
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
                    {canStock && <td className="text-right font-medium">{n(levels[i]!.available)}</td>}
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
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
          <span>
            Page {page} of {pages} · {total} products
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={link({ page: page - 1 > 1 ? String(page - 1) : undefined })} className="btn-secondary btn-sm">
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
