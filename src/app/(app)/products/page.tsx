import Link from "next/link";
import { AlertTriangle, Boxes, Handshake, Package, PackageCheck, Plus, QrCode, Search, ShoppingCart } from "lucide-react";
import StockTabs from "@/components/inventory/StockTabs";
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
import { fmtQty, inPacks, largestPack, packNote, qtyText } from "@/lib/qty";
import { getUnitMode } from "@/lib/unit-mode";
import { formatMoney } from "@/lib/money";
import { getCurrency } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { labelExistingStockAction } from "../items/actions";

export const metadata = { title: "Products" };

const PAGE_SIZE = 24;

type Search = { q?: string; category?: string; status?: string; page?: string; view?: string };

const num = (d: { toString(): string } | null | undefined) => Number(d?.toString() ?? 0);

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const mode = await getUnitMode();
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
      include: { category: { select: { name: true } }, brand: { select: { name: true } }, baseUnit: { select: { symbol: true } }, image: { select: { updatedAt: true } }, units: { include: { unit: { select: { symbol: true } } } } },
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
      subtitle: [p.category.name, p.brand?.name, packNote(largestPack(p.units.map((u) => ({ symbol: u.unit.symbol, factor: u.factor }))), p.baseUnit.symbol)].filter(Boolean).join(" · "),
      price: formatMoney(p.sellingPrice, currency),
      inactive: p.status === "INACTIVE",
      pack: largestPack(p.units.map((u) => ({ symbol: u.unit.symbol, factor: u.factor }))),
      baseSymbol: p.baseUnit.symbol,
    };
  });

  // numbers on top: the whole catalogue, not just this page. Cartons first; pieces as the small second line.
  let top: { products: number; inShop: string; inShopPcs: string | null; withResellers: string; sold: string; restock: number } | null = null;
  if (canStock) {
    const [catalogue, locations, soldByProduct] = await Promise.all([
      db.product.findMany({ where: { status: "ACTIVE" }, select: { id: true, minStock: true, units: { select: { factor: true, unit: { select: { symbol: true } } } } } }),
      db.location.findMany({ select: { id: true, type: true } }),
      db.inventoryItem.groupBy({ by: ["productId"], where: { status: "SOLD" }, _count: true }),
    ]);
    const isReseller = new Set(locations.filter((l) => l.type === "RESELLER").map((l) => l.id));
    const packOf = new Map(catalogue.map((c) => [c.id, largestPack(c.units.map((u) => ({ symbol: u.unit.symbol, factor: u.factor })))]));
    const onShelf = new Map<string, number>();
    let shelfCtn = 0;
    let heldCtn = 0;
    let shelfPcs = 0;
    let heldPcs = 0;
    for (const b of allBalances) {
      const n = num(b._sum.quantity);
      const pk = packOf.get(b.productId) ?? null;
      if (isReseller.has(b.locationId)) {
        heldCtn += inPacks(n, pk);
        heldPcs += n;
      } else {
        shelfCtn += inPacks(n, pk);
        shelfPcs += n;
        onShelf.set(b.productId, (onShelf.get(b.productId) ?? 0) + n);
      }
    }
    const soldCtn = soldByProduct.reduce((t, r) => t + inPacks(r._count, packOf.get(r.productId) ?? null), 0);
    const soldPcs = soldByProduct.reduce((t, r) => t + r._count, 0);
    const round = (x: number) => fmtQty(Number(x.toFixed(1)));
    // the same figures in cartons (default) or pieces, following the CTN | PCS switch
    const pcs = mode === "pcs";
    top = { products: catalogue.length, inShop: pcs ? `${fmtQty(shelfPcs)} PCS` : `${round(shelfCtn)} CTN`, inShopPcs: null as string | null, withResellers: pcs ? `${fmtQty(heldPcs)} PCS` : `${round(heldCtn)} CTN`, sold: pcs ? `${fmtQty(soldPcs)} PCS` : `${round(soldCtn)} CTN`, restock: catalogue.filter((c) => (onShelf.get(c.id) ?? 0) <= num(c.minStock)).length };
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
        description="Everything you sell. Open a product to change it or see its stock."
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
      <StockTabs active="products" user={user} />

      {top && (
        <section className="card mb-3 grid grid-cols-2 divide-line sm:grid-cols-5 sm:divide-x" aria-label="Numbers">
          {[
            { label: "Products", value: n(top.products), hint: "active, on sale", tone: "" },
            { label: "In the shop", value: top.inShop, hint: top.inShopPcs ?? "on the shelf", tone: "text-emerald-700" },
            { label: "With winga", value: top.withResellers, hint: "held on trust", tone: "text-blue-700" },
            { label: "Sold", value: top.sold, hint: "sold so far", tone: "" },
            { label: "Restock", value: n(top.restock), hint: top.restock > 0 ? "low or out" : "nothing low", tone: top.restock > 0 ? "text-yellow-700" : "" },
          ].map((k) => (
            <div key={k.label} className="min-w-0 px-4 py-2.5">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{k.label}</p>
              <p className={cn("truncate text-lg font-semibold leading-tight text-slate-900", k.tone)}>{k.value}</p>
              <p className="truncate text-[11px] text-slate-500">{k.hint}</p>
            </div>
          ))}
        </section>
      )}

      {LABELS_ENABLED && missing > 0 && <LabelExistingStock missing={missing} action={labelExistingStockAction} />}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <form className="flex min-w-0 flex-1 flex-wrap items-center gap-2" method="get">
          {sp.view && <input type="hidden" name="view" value={sp.view} />}
          <div className="relative min-w-[12rem] flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input name="q" defaultValue={q} placeholder="Search name, code or barcode" className="input h-9 pl-9 text-sm" aria-label="Search products" />
          </div>
          <select name="category" defaultValue={sp.category ?? ""} className="input h-9 w-auto text-sm" aria-label="Category">
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select name="status" defaultValue={sp.status ?? "active"} className="input h-9 w-auto text-sm" aria-label="Status">
            <option value="active">Active</option>
            <option value="inactive">Deleted</option>
            <option value="all">All</option>
          </select>
          <button className="btn-primary btn-sm h-9" type="submit">
            Filter
          </button>
          {hasFilters && (
            <Link href={link({ q: undefined, category: undefined, status: undefined, page: undefined })} className="text-sm text-slate-500 hover:text-slate-800">
              Clear
            </Link>
          )}
        </form>
        <div className="inline-flex rounded-lg border border-line bg-white p-0.5 text-sm" role="group" aria-label="View">
          {[
            { key: "cards", label: "Cards" },
            { key: "table", label: "Table" },
          ].map((v) => (
            <Link key={v.key} href={link({ view: v.key === "cards" ? undefined : v.key, page: undefined })} aria-current={view === v.key ? "page" : undefined} className={cn("rounded-md px-3 py-1 font-medium transition", view === v.key ? "bg-navy-700 text-white" : "text-slate-600 hover:text-slate-900")}>
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
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {levels.map((l) => (
            <ProductLevelCard key={l.id} p={l} href={`/products/${l.id}`} showStock={canStock} mode={mode} compact />
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
                    {canStock && <td className="text-right font-medium">{qtyText(levels[i]!.available, levels[i]!.pack ?? null, levels[i]!.baseSymbol ?? "", mode).main}</td>}
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
