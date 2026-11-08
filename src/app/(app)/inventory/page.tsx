import Link from "next/link";
import { ArrowLeftRight, Boxes, CircleCheck, ClipboardCheck, LayoutGrid, List, PackageCheck, Search } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import KpiCard from "@/components/dashboard/KpiCard";
import KpiStrip from "@/components/dashboard/KpiStrip";
import StockCard from "@/components/inventory/StockCard";
import { Prisma } from "@/generated/prisma/client";
import { can, canAny } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { ADJUSTMENT_KIND_LABELS } from "@/lib/inventory/labels";
import { formatMoney } from "@/lib/money";
import { getCurrency } from "@/lib/settings";
import { largestPack, packNote, qtyText } from "@/lib/qty";
import { getUnitMode } from "@/lib/unit-mode";
import { cn, formatDateTime } from "@/lib/utils";

export const metadata = { title: "Stock overview" };

const D = Prisma.Decimal;
const PAGE_SIZE = 24;
type Search = { q?: string; location?: string; category?: string; status?: string; sort?: string; view?: string; page?: string; tab?: string };
type Status = "ok" | "low" | "out";

const SORTS = {
  attention: "Needs attention first",
  name: "Name A to Z",
  low: "Lowest stock first",
  high: "Highest stock first",
  value: "Highest value first",
} as const;
type SortKey = keyof typeof SORTS;
const RANK: Record<Status, number> = { out: 0, low: 1, ok: 2 };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Search> }) {
  const mode = await getUnitMode();
  const user = await requirePagePermission("inventory.view");
  const sp = await searchParams;
  const currency = await getCurrency();
  const canValue = can(user, "inventory.valuation");
  const canHistory = can(user, "inventory.movements");
  const canOpenProduct = can(user, "products.view");
  // a card opens the product's STOCK page (totals, performance, every movement) for people who may; others open the product itself
  const canOpenStock = canAny(user, ["warehouse.operate", "warehouse.view"]);
  const openHref = (id: string) => (canOpenStock ? `/warehouse/stock/${id}` : canOpenProduct ? `/products/${id}` : null);
  const locationId = sp.location || undefined;
  const q = sp.q?.trim().toLowerCase() ?? "";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const view = sp.view === "table" ? "table" : "cards";
  // the history pages next to the stock status pills (Received, Adjustments, Damaged), for people who may see stock documents
  const histTab = canHistory && (sp.tab === "received" || sp.tab === "adjustments" || sp.tab === "damaged") ? sp.tab : null;
  const sort: SortKey = sp.sort && sp.sort in SORTS && (sp.sort !== "value" || canValue) ? (sp.sort as SortKey) : "attention";

  const [products, balances, locations, categories, custody] = await Promise.all([
    db.product.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      include: {
        category: { select: { name: true } },
        brand: { select: { name: true } },
        baseUnit: { select: { symbol: true } },
        units: { include: { unit: { select: { symbol: true } } } },
        image: { select: { updatedAt: true } },
      },
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
    const status: Status = qty.lte(0) ? "out" : p.minStock.gt(0) && qty.lte(p.minStock) ? "low" : "ok";
    return { p, qty, away, status, value: qty.plus(away).mul(p.avgCost) }; // what we own: the shelf plus what resellers hold
  });

  // Headline figures cover the whole catalogue at the chosen location (not the search filter).
  const inStock = rows.filter((r) => r.qty.gt(0)).length;
  const okRows = rows.filter((r) => r.status === "ok");
  const lowRows = rows.filter((r) => r.status === "low");
  const outRows = rows.filter((r) => r.status === "out");
  const totalValue = rows.reduce((s, r) => s.plus(r.value), new D(0));
  const noCost = rows.filter((r) => r.qty.gt(0) && r.p.avgCost.lte(0)).length;
  // What the stock should sell for, and the profit on the products that have both a cost and a selling price (stock held by resellers counts: it is still ours)
  let salesValue = new D(0);
  let profitBase = new D(0);
  let profitCost = new D(0);
  let noPrice = 0;
  for (const r of rows) {
    const have = r.qty.plus(r.away);
    if (have.lte(0)) continue;
    if (r.p.sellingPrice.lte(0)) {
      noPrice++;
      continue;
    }
    const sv = have.mul(r.p.sellingPrice);
    salesValue = salesValue.plus(sv);
    if (r.p.avgCost.gt(0)) {
      profitBase = profitBase.plus(sv);
      profitCost = profitCost.plus(have.mul(r.p.avgCost));
    }
  }
  const expectedProfit = profitBase.minus(profitCost);
  const margin = profitBase.gt(0) ? Math.round(Number(expectedProfit.div(profitBase).mul(100).toString())) : null;
  const noMinimum = rows.filter((r) => r.p.minStock.lte(0)).length;
  const attention = [...outRows, ...lowRows];

  const filtered = rows
    .filter(
      (r) =>
        (!sp.category || r.p.categoryId === sp.category) &&
        (!sp.status || r.status === sp.status) &&
        (!q || r.p.name.toLowerCase().includes(q) || r.p.sku.toLowerCase().includes(q) || (r.p.barcode ?? "").toLowerCase().includes(q)),
    )
    .sort((a, b) => {
      const byName = a.p.name.localeCompare(b.p.name);
      if (sort === "name") return byName;
      if (sort === "low") return a.qty.comparedTo(b.qty) || byName;
      if (sort === "high") return b.qty.comparedTo(a.qty) || byName;
      if (sort === "value") return b.value.comparedTo(a.value) || byName;
      return RANK[a.status] - RANK[b.status] || byName;
    });
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hasFilters = Boolean(q || sp.category || sp.status || locationId);

  const href = (over: Partial<Record<keyof Search, string | undefined>>) => {
    const params = new URLSearchParams();
    const base = { q: sp.q, location: sp.location, category: sp.category, status: sp.status, sort: sp.sort, view: sp.view, ...over };
    for (const [k, v] of Object.entries(base)) if (v) params.set(k, v);
    const s = params.toString();
    return `/inventory${s ? `?${s}` : ""}`;
  };

  // History pages (only for people allowed to see stock documents): the counts for the pills, and the rows of the page that is open
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const [receiptCount, adjustmentCount, damaged, receipts, adjustments] = await Promise.all([
    canHistory ? db.stockReceipt.count() : Promise.resolve(0),
    canHistory ? db.stockAdjustment.count() : Promise.resolve(0),
    canHistory
      ? db.stockMovement.findMany({
          where: { type: "DAMAGED", createdAt: { gte: since } },
          orderBy: { createdAt: "desc" },
          take: 200,
          select: { id: true, quantity: true, unitCost: true, createdAt: true, reason: true, user: { select: { name: true } }, product: { select: { id: true, name: true, baseUnit: { select: { symbol: true } }, units: { include: { unit: { select: { symbol: true } } } } } } },
        })
      : Promise.resolve([]),
    histTab === "received" ? db.stockReceipt.findMany({ orderBy: { createdAt: "desc" }, take: 40, include: { supplier: { select: { name: true } }, receivedBy: { select: { name: true } }, _count: { select: { items: true } } } }) : Promise.resolve([]),
    histTab === "adjustments" ? db.stockAdjustment.findMany({ orderBy: { createdAt: "desc" }, take: 40, include: { location: { select: { name: true } }, createdBy: { select: { name: true } } } }) : Promise.resolve([]),
  ]);
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

  const total = rows.length;
  const pct = (n: number) => (total === 0 ? 0 : (n / total) * 100);
  const segments = [
    { key: "ok", label: "Healthy", n: okRows.length, bar: "bg-emerald-500", dot: "bg-emerald-500" },
    { key: "low", label: "Low", n: lowRows.length, bar: "bg-oil-400", dot: "bg-oil-400" },
    { key: "out", label: "Out of stock", n: outRows.length, bar: "bg-brand-red", dot: "bg-brand-red" },
  ];
  const tabs = [
    { key: "", label: "All", n: total },
    { key: "ok", label: "Healthy", n: okRows.length },
    { key: "low", label: "Low", n: lowRows.length },
    { key: "out", label: "Out of stock", n: outRows.length },
  ];

  const cardProps = ({ p, qty, away, status, value }: (typeof rows)[number]) => {
    const unit = p.baseUnit.symbol;
    const hasMin = p.minStock.gt(0);
    // cartons are shown by default; the card has its own CTN | PCS switch, so it gets the plain numbers
    const pk = largestPack(p.units.map((u) => ({ symbol: u.unit.symbol, factor: u.factor })));
    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      category: p.category.name,
      brand: p.brand?.name ?? null,
      imageV: p.image ? p.image.updatedAt.getTime() : null,
      qtyBase: Number(qty.toString()),
      minBase: hasMin ? Number(p.minStock.toString()) : null,
      awayBase: away.gt(0) ? Number(away.toString()) : null,
      pack: pk,
      baseSymbol: unit,
      levelPct: hasMin ? Math.min(100, (Number(qty.toString()) / (Number(p.minStock.toString()) * 3)) * 100) : null,
      status,
      value: canValue ? formatMoney(value, currency) : null,
      href: openHref(p.id),
    };
  };

  return (
    <>
      <PageHeader title="Stock overview" description="What you have, where it is, and what needs reordering." actions={actions} />

      {/* Headline numbers: ONE slim strip (Nino 2026-11-09: the big cards took too much room) */}
      <KpiStrip className="mb-3">
        {canValue && <KpiCard label="Stock value" value={formatMoney(totalValue, currency)} hint={noCost ? `${noCost} with no buying price yet` : "What the stock cost you"} />}
        {canValue && <KpiCard label="Selling value" value={formatMoney(salesValue, currency)} hint={noPrice ? `${noPrice} with no selling price` : "At today's prices"} />}
        {canValue && <KpiCard label="Expected profit" tone={expectedProfit.lt(0) ? "red" : "navy"} value={profitBase.gt(0) ? formatMoney(expectedProfit, currency) : "—"} hint={profitBase.gt(0) ? (margin !== null ? `${margin}% margin` : "Selling value minus cost") : "Add buying and selling prices"} />}
        <KpiCard label="Products" value={total} hint={`${inStock} in stock`} href={canOpenProduct ? "/products" : undefined} />
        <KpiCard label="Low stock" tone="yellow" value={lowRows.length} hint="At or below minimum" href={href({ status: "low", page: undefined })} active={sp.status === "low" && !histTab} />
        <KpiCard label="Out of stock" tone="red" value={outRows.length} hint={outRows.length ? "Needs reordering" : "Nothing missing"} href={href({ status: "out", page: undefined })} active={sp.status === "out" && !histTab} />
      </KpiStrip>

      {/* Health + what to reorder: one slim card */}
      {total > 0 && (
        <section className="card mb-4 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5">
            <h2 className="text-sm font-semibold text-slate-900">
              Stock health <span className="font-normal text-slate-500">· {total} products</span>
            </h2>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
              {segments.map((s) => (
                <li key={s.key} className="inline-flex items-center gap-1.5">
                  <span className={cn("h-2 w-2 rounded-full", s.dot)} />
                  {s.label} <b className="font-semibold text-slate-900">{s.n}</b> <span>{Math.round(pct(s.n))}%</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-2 flex h-2 gap-0.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${okRows.length} healthy, ${lowRows.length} low, ${outRows.length} out of stock`}>
            {segments.map((s) => (s.n > 0 ? <span key={s.key} className={cn("h-full", s.bar)} style={{ width: `${pct(s.n)}%` }} /> : null))}
          </div>
          {attention.length === 0 ? (
            <p className="mt-2.5 flex items-center gap-1.5 text-xs text-emerald-700">
              <CircleCheck size={14} /> Every product is above its minimum.
            </p>
          ) : (
            <div className="mt-2.5 border-t border-line pt-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Needs attention · {attention.length} to reorder</p>
              <ul className="mt-1 grid gap-x-6 sm:grid-cols-2">
                {attention.slice(0, 8).map((r) => (
                  <li key={r.p.id}>
                    <Link href={openHref(r.p.id) ?? href({ q: r.p.sku, status: undefined, page: undefined })} className="flex items-center gap-2.5 rounded-md py-1 hover:bg-slate-50">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-50">
                        {r.p.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`/api/product-image/${r.p.id}?size=thumb&v=${r.p.image.updatedAt.getTime()}`} alt="" loading="lazy" className="h-full w-full object-contain" />
                        ) : (
                          <Boxes size={14} className="text-slate-300" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-800">{r.p.name}</span>
                      {r.status === "out" ? (
                        <span className="badge-red shrink-0">Out</span>
                      ) : (
                        <span className="shrink-0 text-xs text-slate-500">
                          {(() => {
                            const pk = largestPack(r.p.units.map((u) => ({ symbol: u.unit.symbol, factor: u.factor })));
                            return `${qtyText(Number(r.qty.toString()), pk, r.p.baseUnit.symbol, mode).main} / ${qtyText(Number(r.p.minStock.toString()), pk, r.p.baseUnit.symbol, mode).main}`;
                          })()}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
              {attention.length > 8 && (
                <Link href={href({ sort: "attention", status: undefined, page: undefined })} className="mt-1 inline-block text-xs text-navy-700 hover:underline">
                  See all {attention.length}
                </Link>
              )}
            </div>
          )}
          {noMinimum > 0 && (
            <p className="mt-2 text-[11px] text-slate-500">
              {noMinimum} product{noMinimum > 1 ? "s have" : " has"} no minimum set, so {noMinimum > 1 ? "they" : "it"} can never show as low. Set a minimum on the product page.
            </p>
          )}
        </section>
      )}

      {/* Tabs, view switch and filters */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <nav className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="Stock status">
          {tabs.map((t) => {
            const active = !histTab && (sp.status ?? "") === t.key;
            return (
              <Link
                key={t.key || "all"}
                href={href({ status: t.key || undefined, page: undefined })}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition",
                  active ? "border-navy-700 bg-navy-700 text-white" : "border-line bg-white text-slate-600 hover:border-navy-200 hover:text-slate-900",
                )}
              >
                {t.label}
                <span className={cn("rounded-full px-1.5 text-xs font-semibold", active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600")}>{t.n}</span>
              </Link>
            );
          })}
          {canHistory && <span className="mx-1 h-5 w-px shrink-0 self-center bg-line" aria-hidden />}
          {canHistory &&
            [
              { key: "received", label: "Received", n: receiptCount },
              { key: "adjustments", label: "Adjustments", n: adjustmentCount },
              { key: "damaged", label: "Damaged", n: damaged.length },
            ].map((t) => {
              const active = histTab === t.key;
              return (
                <Link
                  key={t.key}
                  href={`/inventory?tab=${t.key}`}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition",
                    active ? "border-navy-700 bg-navy-700 text-white" : "border-line bg-white text-slate-600 hover:border-navy-200 hover:text-slate-900",
                  )}
                >
                  {t.label}
                  <span className={cn("rounded-full px-1.5 text-xs font-semibold", active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600")}>{t.n}</span>
                </Link>
              );
            })}
        </nav>
        {!histTab && (
        <div className="inline-flex rounded-lg border border-line bg-white p-0.5" role="group" aria-label="View">
            {[
              { key: "cards", label: "Cards", Icon: LayoutGrid, to: href({ view: undefined, page: undefined }) },
              { key: "table", label: "Table", Icon: List, to: href({ view: "table", page: undefined }) },
            ].map(({ key, label, Icon, to }) => (
              <Link key={key} href={to} aria-current={view === key ? "true" : undefined} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition", view === key ? "bg-navy-50 text-navy-800" : "text-slate-500 hover:text-slate-800")}>
                <Icon size={15} /> {label}
              </Link>
            ))}
          </div>
        )}
      </div>

      {!histTab && (
      <>
      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        {sp.status && <input type="hidden" name="status" value={sp.status} />}
        {sp.view && <input type="hidden" name="view" value={sp.view} />}
        <div className="relative min-w-[11rem] flex-1 sm:max-w-xs">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search a product" className="input h-9 pl-9 text-sm" aria-label="Search stock" />
        </div>
        <select name="location" defaultValue={sp.location ?? ""} className="input h-9 w-auto text-sm" aria-label="Location">
          <option value="">All locations</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <select name="category" defaultValue={sp.category ?? ""} className="input h-9 w-auto text-sm" aria-label="Category">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select name="sort" defaultValue={sort} className="input h-9 w-auto text-sm" aria-label="Sort by">
          {(Object.keys(SORTS) as SortKey[])
            .filter((k) => k !== "value" || canValue)
            .map((k) => (
              <option key={k} value={k}>
                {SORTS[k]}
              </option>
            ))}
        </select>
        <div className="flex gap-2">
          <button className="btn-primary h-9 px-4 text-sm" type="submit">
            Apply
          </button>
          {hasFilters && (
            <Link href="/inventory" className="btn-secondary h-9 px-4 text-sm">
              Clear
            </Link>
          )}
        </div>
      </form>

      {/* Products */}
      {pageRows.length === 0 ? (
        <div className="card overflow-hidden">
          <EmptyState
            icon={<Boxes size={22} />}
            title={total === 0 ? "No products yet" : "No products match your filters"}
            description={total === 0 ? "Add products, then receive stock to see quantities here." : undefined}
            action={
              total === 0 && can(user, "products.create") ? (
                <Link href="/products/new" className="btn-primary">
                  Add a product
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : view === "cards" ? (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {pageRows.map((r) => (
            <StockCard key={r.p.id} {...cardProps(r)} />
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
                  <th className="text-right">On the shelf</th>
                  {!locationId && <th className="hidden text-right md:table-cell">With winga</th>}
                  <th className="hidden text-right md:table-cell">Minimum</th>
                  <th>Status</th>
                  {canValue && <th className="hidden text-right lg:table-cell">Value</th>}
                </tr>
              </thead>
              <tbody>
                {pageRows.map(({ p, qty, away, status, value }) => {
                  const pk = largestPack(p.units.map((u) => ({ symbol: u.unit.symbol, factor: u.factor })));
                  const shown = qtyText(Number(qty.toString()), pk, p.baseUnit.symbol, mode);
                  const pack = packNote(pk, p.baseUnit.symbol);
                  return (
                    <tr key={p.id}>
                      <td>
                        {/* the whole product cell opens the product, one press */}
                        <Wrap href={openHref(p.id)}>
                        <div className="flex items-center gap-3">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-50">
                            {p.image ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={`/api/product-image/${p.id}?size=thumb&v=${p.image.updatedAt.getTime()}`} alt="" loading="lazy" className="h-full w-full object-contain" />
                            ) : (
                              <Boxes size={16} className="text-slate-300" />
                            )}
                          </span>
                          <span className="min-w-0">
                            <span className="font-medium">{p.name}</span>
                            <span className="block text-xs text-slate-500">{p.sku}</span>
                          </span>
                        </div>
                        </Wrap>
                      </td>
                      <td className="hidden text-slate-600 sm:table-cell">{p.category.name}</td>
                      <td className="text-right">
                        <span className="font-semibold">{shown.main}</span>
                        {pack && <span className="block text-xs text-slate-500">{pack}</span>}
                      </td>
                      {!locationId && <td className="hidden text-right text-slate-600 md:table-cell">{away.gt(0) ? qtyText(Number(away.toString()), pk, p.baseUnit.symbol, mode).main : "—"}</td>}
                      <td className="hidden text-right text-slate-600 md:table-cell">{p.minStock.gt(0) ? qtyText(Number(p.minStock.toString()), pk, p.baseUnit.symbol, mode).main : "—"}</td>
                      <td>{status === "out" ? <span className="badge-red">Out of stock</span> : status === "low" ? <span className="badge-yellow">Low</span> : <span className="badge-green">In stock</span>}</td>
                      {canValue && <td className="hidden text-right lg:table-cell">{formatMoney(value, currency)}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {filtered.length > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-line bg-white px-4 py-3 text-sm text-slate-600">
          <span>
            Page {page} of {pages} · {filtered.length} products
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={href({ page: page - 1 > 1 ? String(page - 1) : undefined })} className="btn-secondary btn-sm">
                Previous
              </Link>
            )}
            {page < pages && (
              <Link href={href({ page: String(page + 1) })} className="btn-secondary btn-sm">
                Next
              </Link>
            )}
          </div>
        </div>
      )}

      </>
      )}

      {histTab && (
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line px-4 py-2.5">
            <h2 className="text-sm font-semibold text-slate-900">
              {histTab === "received" ? "Received" : histTab === "adjustments" ? "Adjustments" : "Damaged or missing, last 30 days"}
              {histTab === "damaged" && (
                <span className="ml-2 font-normal text-slate-500">
                  {damaged.length} report{damaged.length === 1 ? "" : "s"}
                  {canValue ? ` · written off at cost ${formatMoney(damagedValue, currency)}` : ""}
                </span>
              )}
            </h2>
            <Link href={histTab === "received" ? "/inventory/receiving" : histTab === "adjustments" ? "/inventory/adjustments" : "/inventory/movements?type=DAMAGED"} className="text-xs font-medium text-navy-700 hover:underline">
              {histTab === "damaged" ? "Open the movements" : "Open all"} →
            </Link>
          </div>
          {histTab === "received" &&
            (receipts.length === 0 ? (
              <p className="px-4 py-5 text-sm text-slate-500">Nothing received yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {receipts.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <Link href={`/inventory/receiving/${r.id}`} className="text-[13px] font-semibold text-navy-700 hover:underline">
                        {r.receiptNo}
                      </Link>
                      <p className="truncate text-[11px] text-slate-500">
                        {r.type === "OPENING_STOCK" ? "Opening stock" : (r.supplier?.name ?? "No supplier")} · {r._count.items} item{r._count.items === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      {canValue && <p className="text-[13px] font-semibold tabular-nums text-slate-900">{formatMoney(r.totalCost, currency)}</p>}
                      <p className="text-[11px] text-slate-500">
                        {formatDateTime(r.createdAt)} · {r.receivedBy.name}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ))}
          {histTab === "adjustments" &&
            (adjustments.length === 0 ? (
              <p className="px-4 py-5 text-sm text-slate-500">No adjustments yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {adjustments.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px]">
                        <Link href={`/inventory/adjustments/${a.id}`} className="font-semibold text-navy-700 hover:underline">
                          {a.adjustmentNo}
                        </Link>{" "}
                        <span className="text-slate-500">· {ADJUSTMENT_KIND_LABELS[a.kind]}</span>
                      </p>
                      <p className="truncate text-[11px] text-slate-500">
                        {a.location.name} · {a.reason}
                      </p>
                    </div>
                    <p className="shrink-0 text-right text-[11px] text-slate-500">
                      {formatDateTime(a.createdAt)} · {a.createdBy.name}
                    </p>
                  </li>
                ))}
              </ul>
            ))}
          {histTab === "damaged" &&
            (damaged.length === 0 ? (
              <p className="px-4 py-5 text-sm text-slate-500">Nothing damaged or missing in the last 30 days.</p>
            ) : (
              <ul className="divide-y divide-line">
                {damaged.map((m) => {
                  const pk = largestPack(m.product.units.map((u) => ({ symbol: u.unit.symbol, factor: u.factor })));
                  const to = openHref(m.product.id);
                  return (
                    <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        {to ? (
                          <Link href={to} className="text-[13px] font-semibold text-navy-700 hover:underline">
                            {m.product.name}
                          </Link>
                        ) : (
                          <p className="text-[13px] font-semibold text-slate-900">{m.product.name}</p>
                        )}
                        <p className="truncate text-[11px] text-slate-500">{m.reason ?? "No reason written"}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-[13px] font-semibold tabular-nums text-slate-900">{qtyText(Number(m.quantity.abs().toString()), pk, m.product.baseUnit.symbol, mode).main}</p>
                        <p className="text-[11px] text-slate-500">
                          {formatDateTime(m.createdAt)} · {m.user.name}
                          {canValue && m.unitCost ? ` · ${formatMoney(m.quantity.abs().mul(m.unitCost), currency)}` : ""}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ))}
        </section>
      )}
    </>
  );
}

/** A link around its content when the person may open the page; otherwise just the content. */
function Wrap({ href, children }: { href: string | null; children: React.ReactNode }) {
  return href ? (
    <Link href={href} className="block rounded-lg hover:text-navy-700">
      {children}
    </Link>
  ) : (
    <>{children}</>
  );
}
