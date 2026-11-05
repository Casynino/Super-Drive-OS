import Link from "next/link";
import { Boxes, PackageCheck, Search, ArrowLeftRight, ClipboardCheck } from "lucide-react";
import { EmptyState, PageHeader, Stat } from "@/components/ui";
import { Prisma } from "@/generated/prisma/client";
import { can, canAny } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { ADJUSTMENT_KIND_LABELS } from "@/lib/inventory/labels";
import { formatMoney } from "@/lib/money";
import { getCurrency } from "@/lib/settings";
import { packBreakdown } from "@/lib/units";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Stock overview" };

const D = Prisma.Decimal;
const PAGE_SIZE = 25;
type Search = { q?: string; location?: string; category?: string; status?: string; page?: string };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePagePermission("inventory.view");
  const sp = await searchParams;
  const currency = await getCurrency();
  const canValue = can(user, "inventory.valuation");
  const canHistory = can(user, "inventory.movements");
  const locationId = sp.location || undefined;
  const q = sp.q?.trim().toLowerCase() ?? "";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const [products, balances, locations, categories, custody] = await Promise.all([
    db.product.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      include: { category: { select: { name: true } }, baseUnit: { select: { symbol: true } }, units: { include: { unit: { select: { symbol: true } } } } },
    }),
    // Without a location chosen this is the shop shelf only; stock held by resellers is shown separately.
    db.stockBalance.groupBy({ by: ["productId"], where: locationId ? { locationId } : { location: { type: { not: "RESELLER" } } }, _sum: { quantity: true } }),
    db.location.findMany({ where: { status: "ACTIVE" }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true } }),
    db.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    locationId ? Promise.resolve([]) : db.stockBalance.groupBy({ by: ["productId"], where: { location: { type: "RESELLER" } }, _sum: { quantity: true } }),
  ]);

  const qtyOf = new Map(balances.map((b) => [b.productId, b._sum.quantity ?? new D(0)]));
  const withResellers = new Map(custody.map((b) => [b.productId, b._sum.quantity ?? new D(0)]));
  const rows = products.map((p) => {
    const qty = qtyOf.get(p.id) ?? new D(0);
    const away = withResellers.get(p.id) ?? new D(0);
    const status = qty.lte(0) ? "out" : p.minStock.gt(0) && qty.lte(p.minStock) ? "low" : "ok";
    return { p, qty, away, status, value: qty.plus(away).mul(p.avgCost) }; // what we own: the shelf plus what resellers hold
  });

  // Headline figures cover the whole catalogue at the chosen location (not the search filter).
  const inStock = rows.filter((r) => r.qty.gt(0)).length;
  const lowRows = rows.filter((r) => r.status === "low");
  const outRows = rows.filter((r) => r.status === "out");
  const totalValue = rows.reduce((s, r) => s.plus(r.value), new D(0));
  const noCost = rows.filter((r) => r.qty.gt(0) && r.p.avgCost.lte(0)).length;

  const filtered = rows.filter(
    (r) =>
      (!sp.category || r.p.categoryId === sp.category) &&
      (!sp.status || r.status === sp.status) &&
      (!q || r.p.name.toLowerCase().includes(q) || r.p.sku.toLowerCase().includes(q) || (r.p.barcode ?? "").toLowerCase().includes(q)),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hasFilters = Boolean(q || sp.category || sp.status || locationId);
  const href = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: sp.q, location: sp.location, category: sp.category, status: sp.status })) if (v) params.set(k, v);
    if (p > 1) params.set("page", String(p));
    return `/inventory?${params.toString()}`;
  };

  // Recent activity (only for people allowed to see stock documents)
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const [recentReceipts, recentAdjustments, damaged] = canHistory
    ? await Promise.all([
        db.stockReceipt.findMany({ orderBy: { createdAt: "desc" }, take: 5, include: { supplier: { select: { name: true } }, _count: { select: { items: true } } } }),
        db.stockAdjustment.findMany({ orderBy: { createdAt: "desc" }, take: 5, include: { location: { select: { name: true } } } }),
        db.stockMovement.findMany({ where: { type: "DAMAGED", createdAt: { gte: since } }, select: { quantity: true, unitCost: true } }),
      ])
    : [[], [], []];
  const damagedValue = damaged.reduce((s, m) => s.plus(m.quantity.abs().mul(m.unitCost ?? 0)), new D(0));

  const actions = (
    <>
      {can(user, "inventory.receive") && (
        <Link href="/inventory/receiving/new" className="btn-primary">
          <PackageCheck size={16} /> Receive stock
        </Link>
      )}
      {can(user, "inventory.transfer") && (
        <Link href="/inventory/transfers/new" className="btn-secondary">
          <ArrowLeftRight size={16} /> Transfer
        </Link>
      )}
      {canAny(user, ["inventory.adjust", "inventory.count", "inventory.report_damage"]) && (
        <Link href="/inventory/adjustments/new" className="btn-secondary">
          <ClipboardCheck size={16} /> Adjust
        </Link>
      )}
    </>
  );

  return (
    <>
      <PageHeader title="Stock overview" description="What you have, where it is, and what needs reordering." actions={actions} />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat label="Active products" value={rows.length} hint={`${inStock} in stock`} />
        <Stat label="Low stock" value={lowRows.length} hint="At or below minimum" />
        <Stat label="Out of stock" value={outRows.length} />
        {canValue ? (
          <Stat label="Inventory value" value={formatMoney(totalValue, currency)} hint={noCost ? `${noCost} product${noCost > 1 ? "s" : ""} in stock with no cost` : "At average cost"} />
        ) : (
          <Stat label="Locations" value={locations.length} />
        )}
      </div>

      {(lowRows.length > 0 || outRows.length > 0) && (
        <div className="card card-pad mb-5">
          <h2 className="text-base font-semibold text-slate-900">Needs attention</h2>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-brand-red-dark">Out of stock ({outRows.length})</p>
              <ul className="space-y-1 text-sm">
                {outRows.slice(0, 6).map((r) => (
                  <li key={r.p.id} className="truncate">
                    {r.p.name}
                  </li>
                ))}
                {outRows.length === 0 && <li className="text-slate-500">None</li>}
                {outRows.length > 6 && (
                  <li>
                    <Link href="/inventory?status=out" className="text-navy-700 hover:underline">
                      See all {outRows.length}
                    </Link>
                  </li>
                )}
              </ul>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-yellow-700">Running low ({lowRows.length})</p>
              <ul className="space-y-1 text-sm">
                {lowRows.slice(0, 6).map((r) => (
                  <li key={r.p.id} className="flex justify-between gap-3">
                    <span className="truncate">{r.p.name}</span>
                    <span className="shrink-0 text-slate-500">
                      {r.qty.toString()} / min {r.p.minStock.toString()} {r.p.baseUnit.symbol}
                    </span>
                  </li>
                ))}
                {lowRows.length === 0 && <li className="text-slate-500">None</li>}
                {lowRows.length > 6 && (
                  <li>
                    <Link href="/inventory?status=low" className="text-navy-700 hover:underline">
                      See all {lowRows.length}
                    </Link>
                  </li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}

      <form method="get" className="card card-pad mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr_auto]">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search name, SKU or barcode" className="input pl-9" aria-label="Search stock" />
        </div>
        <select name="location" defaultValue={sp.location ?? ""} className="input" aria-label="Location">
          <option value="">All locations</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <select name="category" defaultValue={sp.category ?? ""} className="input" aria-label="Category">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={sp.status ?? ""} className="input" aria-label="Stock status">
          <option value="">Any status</option>
          <option value="ok">In stock</option>
          <option value="low">Low</option>
          <option value="out">Out of stock</option>
        </select>
        <div className="flex gap-2">
          <button className="btn-primary" type="submit">
            Filter
          </button>
          {hasFilters && (
            <Link href="/inventory" className="btn-secondary">
              Clear
            </Link>
          )}
        </div>
      </form>

      <div className="card overflow-hidden">
        {pageRows.length === 0 ? (
          <EmptyState
            icon={<Boxes size={22} />}
            title={rows.length === 0 ? "No products yet" : "No products match your filters"}
            description={rows.length === 0 ? "Add products, then receive stock to see quantities here." : undefined}
            action={
              rows.length === 0 && can(user, "products.create") ? (
                <Link href="/products/new" className="btn-primary">
                  Add a product
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
                  <th className="text-right">On the shelf</th>
                  {!locationId && <th className="hidden text-right md:table-cell">With resellers</th>}
                  <th className="hidden text-right md:table-cell">Minimum</th>
                  <th>Status</th>
                  {canValue && <th className="hidden text-right lg:table-cell">Value</th>}
                </tr>
              </thead>
              <tbody>
                {pageRows.map(({ p, qty, away, status, value }) => {
                  const pack = packBreakdown(qty, p.baseUnit.symbol, p.units.map((u) => ({ symbol: u.unit.symbol, factor: u.factor })));
                  return (
                    <tr key={p.id}>
                      <td>
                        <span className="font-medium">{p.name}</span>
                        <span className="block text-xs text-slate-500">{p.sku}</span>
                      </td>
                      <td className="hidden text-slate-600 sm:table-cell">{p.category.name}</td>
                      <td className="text-right">
                        <span className="font-semibold">
                          {qty.toString()} {p.baseUnit.symbol}
                        </span>
                        {pack && <span className="block text-xs text-slate-500">{pack}</span>}
                      </td>
                      {!locationId && <td className="hidden text-right text-slate-600 md:table-cell">{away.gt(0) ? `${away.toString()} ${p.baseUnit.symbol}` : "—"}</td>}
                      <td className="hidden text-right text-slate-600 md:table-cell">{p.minStock.gt(0) ? `${p.minStock.toString()} ${p.baseUnit.symbol}` : "—"}</td>
                      <td>{status === "out" ? <span className="badge-red">Out of stock</span> : status === "low" ? <span className="badge-yellow">Low</span> : <span className="badge-green">In stock</span>}</td>
                      {canValue && <td className="hidden text-right lg:table-cell">{formatMoney(value, currency)}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {filtered.length > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-slate-600">
            <span>
              Page {page} of {pages} · {filtered.length} products
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

      {canHistory && (
        <div className="mt-6 grid gap-5 lg:grid-cols-3">
          <section className="card overflow-hidden">
            <h2 className="border-b border-line px-5 py-3 text-base font-semibold text-slate-900">Recently received</h2>
            {recentReceipts.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500">Nothing received yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {recentReceipts.map((r) => (
                  <li key={r.id} className="px-5 py-3 text-sm">
                    <Link href={`/inventory/receiving/${r.id}`} className="font-medium text-navy-700 hover:underline">
                      {r.receiptNo}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {r.type === "OPENING_STOCK" ? "Opening stock" : (r.supplier?.name ?? "No supplier")} · {r._count.items} item{r._count.items === 1 ? "" : "s"} · {formatDateTime(r.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card overflow-hidden">
            <h2 className="border-b border-line px-5 py-3 text-base font-semibold text-slate-900">Recent adjustments</h2>
            {recentAdjustments.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500">No adjustments yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {recentAdjustments.map((a) => (
                  <li key={a.id} className="px-5 py-3 text-sm">
                    <Link href={`/inventory/adjustments/${a.id}`} className="font-medium text-navy-700 hover:underline">
                      {a.adjustmentNo}
                    </Link>{" "}
                    <span className="text-slate-500">· {ADJUSTMENT_KIND_LABELS[a.kind]}</span>
                    <p className="truncate text-xs text-slate-500">
                      {a.location.name} · {a.reason}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card card-pad">
            <h2 className="text-base font-semibold text-slate-900">Damaged / missing (30 days)</h2>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{damaged.length}</p>
            <p className="text-sm text-slate-500">report{damaged.length === 1 ? "" : "s"}</p>
            {canValue && <p className="mt-3 text-sm text-slate-600">Written off at cost: <span className="font-semibold">{formatMoney(damagedValue, currency)}</span></p>}
            <Link href="/inventory/movements?type=DAMAGED" className="mt-3 inline-block text-sm text-navy-700 hover:underline">
              View damaged stock
            </Link>
          </section>
        </div>
      )}
    </>
  );
}
