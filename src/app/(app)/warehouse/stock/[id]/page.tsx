import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowDownToLine, ArrowUpFromLine, ImageOff } from "lucide-react";
import ProductPerformance from "@/components/products/ProductPerformance";
import { PageHeader } from "@/components/ui";
import StockChangeButtons from "@/components/inventory/StockChangeButtons";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { MOVEMENT_LABELS, documentHref } from "@/lib/inventory/labels";
import { largestPack, packNote, qtyText } from "@/lib/qty";
import { cn, formatDateTime } from "@/lib/utils";

export const metadata = { title: "Stock" };

const PAGE = 20;
const COLS = "lg:grid-cols-[9rem_minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,1fr)]";
const BAR = { ok: "bg-emerald-500", low: "bg-oil-400", out: "bg-brand-red" } as const;
const BADGE = { ok: "badge-green", low: "badge-yellow", out: "badge-red" } as const;
const WORD = { ok: "In stock", low: "Low", out: "Out of stock" } as const;

/**
 * One product's stock, opened from a card on the Warehouse stock page (Nino 2026-11-08: "open the card and see the stock movement inside, and take some action,
 * the admin too"): the numbers, where the stock is, Add / Remove / Count, and every movement of this product (received, sold, damaged, adjusted, returned).
 */
export default async function StockProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string; type?: string }> }) {
  const user = await requireUser();
  if (!canAny(user, ["warehouse.operate", "warehouse.view"])) redirect("/forbidden");
  const { id } = await params;
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  // a busy product has many movements: they are paged (20 at a time) and can be narrowed to one kind (received, sold, damaged, ...)
  const type = sp.type && sp.type in MOVEMENT_LABELS ? (sp.type as keyof typeof MOVEMENT_LABELS) : undefined;
  const seeMovements = can(user, "inventory.movements");

  const product = await db.product.findUnique({
    where: { id },
    select: { id: true, name: true, sku: true, minStock: true, status: true, brand: { select: { name: true } }, category: { select: { name: true } }, image: { select: { updatedAt: true } }, baseUnit: { select: { symbol: true } }, units: { select: { factor: true, unit: { select: { symbol: true } } } } },
  });
  if (!product) notFound();
  const pack = largestPack(product.units.map((u) => ({ symbol: u.unit.symbol, factor: u.factor })));
  const sym = product.baseUnit.symbol;
  const say = (n: number) => qtyText(n, pack, sym).main;
  const num = (d: { toString(): string }) => Number(d.toString());

  const [balances, total, kinds, movements] = await Promise.all([
    db.stockBalance.findMany({ where: { productId: id }, select: { quantity: true, reserved: true, location: { select: { name: true, type: true, pickupRequired: true } } }, orderBy: { location: { name: "asc" } } }),
    seeMovements ? db.stockMovement.count({ where: { productId: id, ...(type ? { type: type as never } : {}) } }) : Promise.resolve(0),
    seeMovements ? db.stockMovement.groupBy({ by: ["type"], where: { productId: id }, _count: { _all: true } }) : Promise.resolve([]),
    seeMovements ? db.stockMovement.findMany({ where: { productId: id, ...(type ? { type: type as never } : {}) }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE, include: { user: { select: { name: true } }, location: { select: { name: true } } } }) : Promise.resolve([]),
  ]);

  // the warehouse's own stock (where sales are picked up), and everything else the product is held in (Winga, other places)
  const shelf = balances.filter((b) => b.location.pickupRequired);
  const qty = shelf.reduce((t, b) => t + num(b.quantity), 0);
  const reserved = shelf.reduce((t, b) => t + num(b.reserved), 0);
  const available = Math.max(qty - reserved, 0);
  const min = num(product.minStock);
  const status = available <= 0 ? ("out" as const) : min > 0 && available <= min ? ("low" as const) : ("ok" as const);
  const pct = min > 0 ? Math.min(100, (available / (3 * min)) * 100) : null;
  const elsewhere = balances.filter((b) => !b.location.pickupRequired && num(b.quantity) > 0);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const href = (p: number, t: string | undefined = type) => {
    const qs = new URLSearchParams({ ...(t ? { type: t } : {}), ...(p > 1 ? { page: String(p) } : {}) }).toString();
    return `/warehouse/stock/${id}${qs ? `?${qs}` : ""}`;
  };
  const allCount = kinds.reduce((t2, k) => t2 + k._count._all, 0);
  const canAdjust = can(user, "inventory.adjust");
  const canCount = can(user, "inventory.count") || canAdjust;
  const manyLocations = balances.length > 1;


  const tile = (label: string, value: string, hint?: string, tone?: string) => (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn("mt-0.5 truncate text-xl font-bold leading-tight tracking-tight text-slate-900", tone)}>{value}</p>
      {hint && <p className="truncate text-xs text-slate-500">{hint}</p>}
    </div>
  );

  return (
    <>
      <PageHeader title={product.name} description={[product.brand?.name, product.category.name, product.sku].filter(Boolean).join(" · ")} back={{ href: "/warehouse/stock", label: "Warehouse stock" }} />

      <section className="card mb-4 overflow-hidden">
        <div className="flex flex-wrap items-start gap-4 p-4 sm:p-5">
          <span className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-white">
            {product.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/product-image/${product.id}?size=thumb&v=${product.image.updatedAt.getTime()}`} alt="" className="h-full w-full object-contain" />
            ) : (
              <ImageOff size={22} className="text-slate-300" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={BADGE[status]}>{WORD[status]}</span>
              {pack && <span className="text-xs text-slate-500">{packNote(pack, sym)}</span>}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-4">
              {tile("Available", say(available), "can still be sold", status === "out" ? "text-brand-red-dark" : status === "low" ? "text-yellow-700" : undefined)}
              {tile("Sold, waiting", say(reserved), reserved > 0 ? "to be collected" : "nothing waiting")}
              {tile("On the shelf", say(qty), "in all, with the waiting ones")}
              {tile("Minimum", min > 0 ? say(min) : "None", min > 0 ? "alert level" : "no low-stock alert")}
            </dl>
            {pct !== null && (
              <div className="mt-3 max-w-md">
                <div className="relative h-1.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`Level against a minimum of ${say(min)}`}>
                  <div className={cn("h-full rounded-full", BAR[status])} style={{ width: `${Math.max(status === "out" ? 0 : 4, pct)}%` }} />
                  <span className="absolute inset-y-0 left-1/3 w-px bg-slate-400/70" />
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-5">
          {canAdjust || canCount ? (
            <StockChangeButtons productId={product.id} name={product.name} sku={product.sku} imageV={product.image ? product.image.updatedAt.getTime() : null} pack={pack} baseSymbol={sym} total={qty} reserved={reserved} canCount={canCount} allowChange={canAdjust} />
          ) : (
            <span />
          )}
          {can(user, "products.view") && (
            <Link href={`/products/${product.id}`} className="text-sm font-medium text-navy-700 hover:underline">
              Open the product page
            </Link>
          )}
        </div>
      </section>

      {seeMovements && <ProductPerformance productId={product.id} pack={pack} baseSymbol={sym} showValue={can(user, "inventory.valuation")} />}

      {elsewhere.length > 0 && (
        <section className="card mb-4 overflow-hidden" aria-label="Where the rest of the stock is">
          <h2 className="border-b border-line px-4 py-3 text-base font-semibold text-slate-900 sm:px-5">Held in other places</h2>
          <ul className="divide-y divide-line text-sm">
            {elsewhere.map((b) => (
              <li key={b.location.name} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                <span className="min-w-0 truncate text-slate-800">
                  {b.location.name}
                  {b.location.type === "RESELLER" && <span className="ml-2 rounded-full bg-oil-400/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-yellow-800 dark:text-oil-400">Winga</span>}
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-slate-900">{say(num(b.quantity))}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {seeMovements && (
        <section className="card overflow-hidden" aria-label="Stock movements">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
            <h2 className="text-base font-semibold text-slate-900">Stock movements</h2>
            <span className="text-xs text-slate-500">{total.toLocaleString("en-US")} {type ? MOVEMENT_LABELS[type]!.label.toLowerCase() : "in all"}, newest first</span>
          </div>
          {kinds.length > 1 && (
            <nav className="flex flex-wrap gap-1.5 border-b border-line px-4 py-2.5 sm:px-5" aria-label="Kind of movement">
              {[{ key: undefined as string | undefined, label: "All", n: allCount }, ...kinds.map((k) => ({ key: k.type as string | undefined, label: MOVEMENT_LABELS[k.type]?.label ?? k.type, n: k._count._all }))].map((pill) => (
                <Link key={pill.label} href={href(1, pill.key)} aria-current={type === pill.key ? "true" : undefined} className={cn("rounded-full border px-2.5 py-1 text-xs font-medium transition", type === pill.key ? "border-navy-600 bg-navy-700 text-white" : "border-line bg-white text-slate-600 hover:border-navy-200 hover:text-slate-900")}>
                  {pill.label} <span className="opacity-70">{pill.n}</span>
                </Link>
              ))}
            </nav>
          )}
          {movements.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">Nothing has moved for this product yet.</p>
          ) : (
            <>
              <div className={cn("hidden items-center gap-x-4 border-b border-line bg-slate-50 px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 lg:grid", COLS)}>
                <span>When</span>
                <span>What happened</span>
                <span className="text-right">Change</span>
                <span className="text-right">Stock after</span>
                <span>Document</span>
                <span>Done by</span>
              </div>
              <ul>
                {movements.map((m) => {
                  const t = MOVEMENT_LABELS[m.type]!;
                  const neg = m.quantity.isNegative();
                  const doc = documentHref(m.referenceType, m.referenceId);
                  return (
                    <li key={m.id} className={cn("grid grid-cols-2 items-center gap-x-4 gap-y-1.5 border-b border-line/70 px-4 py-3 last:border-b-0 sm:px-5", COLS)}>
                      <span className="col-span-2 text-xs tabular-nums text-slate-500 lg:col-span-1 lg:text-sm">{formatDateTime(m.createdAt)}</span>
                      <div className="col-span-2 min-w-0 lg:col-span-1">
                        <span className={t.badge}>{t.label}</span>
                        {manyLocations && <span className="ml-2 text-xs text-slate-400">{m.location.name}</span>}
                        {m.reason && (
                          <span className="mt-0.5 block truncate text-xs text-slate-500" title={m.reason}>
                            {m.reason}
                          </span>
                        )}
                      </div>
                      <span className={cn("inline-flex items-center gap-1 text-sm font-bold tabular-nums lg:justify-end", neg ? "text-brand-red-dark" : "text-emerald-700")}>
                        {neg ? <ArrowUpFromLine size={14} /> : <ArrowDownToLine size={14} />}
                        {neg ? "−" : "+"}
                        {say(Math.abs(num(m.quantity)))}
                      </span>
                      <span className="text-right text-sm tabular-nums text-slate-800">
                        {say(num(m.newQty))}
                        <span className="block text-xs text-slate-400">was {say(num(m.previousQty))}</span>
                      </span>
                      <span className="min-w-0 truncate text-sm">
                        {doc ? (
                          <Link href={doc} className="font-medium text-navy-700 hover:underline">
                            {m.referenceNo}
                          </Link>
                        ) : (
                          <span className="text-slate-500">{m.referenceNo ?? "—"}</span>
                        )}
                      </span>
                      <span className="min-w-0 truncate text-sm text-slate-700">{m.user.name}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {total > PAGE && (
            <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-slate-600">
              <span>
                Page {page} of {pages}
              </span>
              <span className="flex gap-2">
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
              </span>
            </div>
          )}
        </section>
      )}
    </>
  );
}
