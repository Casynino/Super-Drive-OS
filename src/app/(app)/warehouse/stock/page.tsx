import Link from "next/link";
import { redirect } from "next/navigation";
import { Search } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import WarehouseStockCard from "@/components/warehouse/WarehouseStockCard";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { largestPack } from "@/lib/qty";
import { cn } from "@/lib/utils";

export const metadata = { title: "Warehouse stock" };

/**
 * What is in the warehouse, product by product, in the same cards as the Stock overview so the warehouse and the Director read it the same way.
 * The big number is what is AVAILABLE (can still be sold); what is already sold and waiting to be collected is shown under the bar.
 */
export default async function WarehouseStockPage({ searchParams }: { searchParams: Promise<{ q?: string; s?: string; o?: string }> }) {
  const user = await requireUser();
  if (!canAny(user, ["warehouse.operate", "warehouse.view"])) redirect("/forbidden");
  const sp = await searchParams;
  const q = sp.q?.trim().toLowerCase() ?? "";
  const filter = sp.s === "low" || sp.s === "out" || sp.s === "reserved" ? sp.s : "all";
  const sort = sp.o === "high" || sp.o === "name" ? sp.o : "low"; // lowest first by default (Nino 2026-11-08: "arrange them from low to high, don't mix")

  const [products, balances] = await Promise.all([
    db.product.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true, sku: true, minStock: true, brand: { select: { name: true } }, category: { select: { name: true } }, image: { select: { updatedAt: true } }, baseUnit: { select: { symbol: true } }, units: { select: { factor: true, unit: { select: { symbol: true } } } } } }),
    db.stockBalance.groupBy({ by: ["productId"], where: { location: { pickupRequired: true } }, _sum: { quantity: true, reserved: true } }),
  ]);
  const bal = new Map(balances.map((b) => [b.productId, { qty: Number(b._sum.quantity ?? 0), reserved: Number(b._sum.reserved ?? 0) }]));
  const all = products.map((p) => {
    const b = bal.get(p.id) ?? { qty: 0, reserved: 0 };
    const available = Math.max(b.qty - b.reserved, 0);
    const min = Number(p.minStock);
    const status = available <= 0 ? ("out" as const) : min > 0 && available <= min ? ("low" as const) : ("ok" as const);
    return { p, ...b, available, status, min };
  });
  const counts = { all: all.length, low: all.filter((r) => r.status === "low").length, out: all.filter((r) => r.status === "out").length, reserved: all.filter((r) => r.reserved > 0).length };
  // in cartons, the way he reads them (a product with 4 pieces to a carton and one with 12 are not compared in pieces)
  const inCartons = (r: (typeof all)[number]) => {
    const f = largestPack(r.p.units.map((u) => ({ symbol: u.unit.symbol, factor: u.factor })))?.factor ?? 1;
    return r.available / f;
  };
  const rows = all
    .filter((r) => (!q || `${r.p.name} ${r.p.sku} ${r.p.category.name} ${r.p.brand?.name ?? ""}`.toLowerCase().includes(q)) && (filter === "all" || (filter === "reserved" ? r.reserved > 0 : r.status === filter)))
    .sort((a, b) => (sort === "name" ? 0 : sort === "high" ? inCartons(b) - inCartons(a) : inCartons(a) - inCartons(b)) || a.p.name.localeCompare(b.p.name));
  const totals = { qty: all.reduce((t, r) => t + r.qty, 0), reserved: all.reduce((t, r) => t + r.reserved, 0) };
  const pill = (on: boolean) => cn("rounded-full border px-3 py-1.5 text-sm font-medium transition", on ? "border-navy-600 bg-navy-700 text-white" : "border-line bg-white text-slate-600 hover:border-navy-200 hover:text-slate-900");
  const href = (s: string, o: string = sort) => {
    const qs = new URLSearchParams({ ...(s !== "all" ? { s } : {}), ...(q ? { q } : {}), ...(o !== "low" ? { o } : {}) }).toString();
    return `/warehouse/stock${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <PageHeader title="Warehouse stock" description={`${all.length} products · ${totals.qty.toLocaleString("en-US")} pieces in the warehouse, ${totals.reserved.toLocaleString("en-US")} of them sold and waiting to be collected.`} />
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2.5">
        <div className="flex flex-wrap gap-2">
          {([["all", "All"], ["low", "Running low"], ["out", "Out of stock"], ["reserved", "Reserved"]] as const).map(([k, label]) => (
            <Link key={k} href={href(k)} className={pill(filter === k)}>
              {label} <span className="text-xs opacity-80">{counts[k]}</span>
            </Link>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1 rounded-full border border-line p-0.5 text-sm" role="group" aria-label="Arrange by quantity">
          {([["low", "Lowest first"], ["high", "Highest first"], ["name", "A to Z"]] as const).map(([k, label]) => (
            <Link key={k} href={href(filter, k)} aria-current={sort === k ? "true" : undefined} className={cn("rounded-full px-3 py-1 font-medium transition", sort === k ? "bg-navy-700 text-white" : "text-slate-600 hover:text-slate-900")}>
              {label}
            </Link>
          ))}
        </div>
        <form method="get" className="relative flex w-full min-w-0 items-center gap-2 sm:w-64">
          {filter !== "all" && <input type="hidden" name="s" value={filter} />}
          {sort !== "low" && <input type="hidden" name="o" value={sort} />}
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search a product" className="input h-10 pl-9" aria-label="Search the warehouse stock" />
        </form>
      </div>
      {rows.length === 0 ? (
        <div className="card">
          <EmptyState title="No products match" description="Try another filter or search." />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {rows.map((r) => (
            <WarehouseStockCard
              key={r.p.id}
              id={r.p.id}
              name={r.p.name}
              sku={r.p.sku}
              category={r.p.category.name}
              brand={r.p.brand?.name ?? null}
              imageV={r.p.image ? r.p.image.updatedAt.getTime() : null}
              available={r.available}
              reserved={r.reserved}
              total={r.qty}
              min={r.min > 0 ? r.min : null}
              pack={largestPack(r.p.units.map((u) => ({ symbol: u.unit.symbol, factor: u.factor })))}
              baseSymbol={r.p.baseUnit.symbol}
              status={r.status}
              canAdjust={can(user, "inventory.adjust")}
              canCount={can(user, "inventory.count") || can(user, "inventory.adjust")}
            />
          ))}
        </div>
      )}
    </>
  );
}
