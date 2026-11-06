import Link from "next/link";
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, ImageOff, Scale, Search } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import KpiCard from "@/components/dashboard/KpiCard";
import { Prisma, type StockMovementType } from "@/generated/prisma/client";
import { can } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { todayYmd } from "@/lib/dashboard/range";
import { db } from "@/lib/db";
import { MOVEMENT_LABELS, documentHref } from "@/lib/inventory/labels";
import { formatMoney } from "@/lib/money";
import { fmtQty, inPacks, largestPack, qtyText } from "@/lib/qty";
import { getCurrency } from "@/lib/settings";
import { cn } from "@/lib/utils";

export const metadata = { title: "Stock movements" };

const PAGE_SIZE = 50;
const TZ = "Africa/Dar_es_Salaam";
type Search = { q?: string; location?: string; type?: string; from?: string; to?: string; page?: string };
const isDate = (s?: string) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));
const num = (d: { toString(): string } | null | undefined) => Number(d?.toString() ?? 0);

const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d); // YYYY-MM-DD in the business time zone
const timeOf = (d: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(d);
const dayTitle = (key: string, today: string, yesterday: string) =>
  key === today ? "Today" : key === yesterday ? "Yesterday" : new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));

/** The whole ledger, grouped by day, with the numbers that matter on top and the type as quick filters. Nothing here edits stock: it only reads the ledger. */
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

  // everything except the type, so the type pills can show how many each type has
  const base: Prisma.StockMovementWhereInput = {
    ...(sp.location ? { locationId: sp.location } : {}),
    ...(Object.keys(createdAt).length ? { createdAt } : {}),
    ...(q ? { OR: [{ product: { name: { contains: q, mode: "insensitive" } } }, { product: { sku: { contains: q, mode: "insensitive" } } }, { referenceNo: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const where: Prisma.StockMovementWhereInput = { ...base, ...(type ? { type } : {}) };

  const [rows, total, locations, byType, inByProduct, outByProduct] = await Promise.all([
    db.stockMovement.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        product: { select: { id: true, name: true, sku: true, baseUnit: { select: { symbol: true } }, units: { select: { factor: true, unit: { select: { symbol: true } } } }, image: { select: { updatedAt: true } } } },
        location: { select: { name: true } },
        user: { select: { name: true } },
      },
    }),
    db.stockMovement.count({ where }),
    db.location.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.stockMovement.groupBy({ by: ["type"], where: base, _count: true }),
    db.stockMovement.groupBy({ by: ["productId"], where: { ...where, quantity: { gt: 0 } }, _sum: { quantity: true } }),
    db.stockMovement.groupBy({ by: ["productId"], where: { ...where, quantity: { lt: 0 } }, _sum: { quantity: true } }),
  ]);

  // totals for the whole filtered ledger (not just this page), in cartons: every product counted with its own carton size
  const ids = [...new Set([...inByProduct, ...outByProduct].map((r) => r.productId))];
  const packs = new Map(
    (ids.length ? await db.product.findMany({ where: { id: { in: ids } }, select: { id: true, units: { select: { factor: true, unit: { select: { symbol: true } } } } } }) : []).map((p) => [p.id, largestPack(p.units.map((u) => ({ symbol: u.unit.symbol, factor: u.factor })))]),
  );
  const ctn = (rows2: { productId: string; _sum: { quantity: Prisma.Decimal | null } }[]) => rows2.reduce((t, r) => t + inPacks(Math.abs(num(r._sum.quantity)), packs.get(r.productId) ?? null), 0);
  const stockIn = ctn(inByProduct);
  const stockOut = ctn(outByProduct);
  const net = stockIn - stockOut;
  const one = (x: number) => fmtQty(Number(x.toFixed(1)));

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(q || sp.location || type || sp.from || sp.to);
  const link = (over: Partial<Search>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, location: sp.location, type: sp.type, from: sp.from, to: sp.to, ...over })) if (v) params.set(k, String(v));
    const s = params.toString();
    return `/inventory/movements${s ? `?${s}` : ""}`;
  };
  const allCount = byType.reduce((t, r) => t + r._count, 0);
  const pills = [{ key: "", label: "All", n: allCount }, ...Object.entries(MOVEMENT_LABELS).map(([k, v]) => ({ key: k, label: v.label, n: byType.find((r) => r.type === k)?._count ?? 0 })).filter((p) => p.n > 0)];

  // group this page's rows by day
  const today = todayYmd();
  const yesterday = dayKey(new Date(Date.now() - 24 * 3600 * 1000));
  const groups: { key: string; rows: typeof rows }[] = [];
  for (const m of rows) {
    const k = dayKey(m.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.key === k) last.rows.push(m);
    else groups.push({ key: k, rows: [m] });
  }

  const COLS = showCost ? "lg:grid-cols-[3.5rem_minmax(0,2fr)_minmax(0,1.2fr)_7.5rem_8rem_6.5rem_9.5rem_minmax(0,1fr)]" : "lg:grid-cols-[3.5rem_minmax(0,2fr)_minmax(0,1.2fr)_7.5rem_8rem_9.5rem_minmax(0,1fr)]";

  return (
    <>
      <PageHeader title="Stock movements" description="Every change to stock, newest first: what moved, how much, and who did it. Nothing here can be edited." />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <KpiCard icon={ArrowLeftRight} tone="navy" label="Movements" value={fmtQty(total)} hint={hasFilters ? "Matching your filters" : "All recorded changes"} />
        <KpiCard icon={ArrowDownToLine} tone="green" label="Stock in" value={`${one(stockIn)} CTN`} hint="Received, returned and added" />
        <KpiCard icon={ArrowUpFromLine} tone="red" label="Stock out" value={`${one(stockOut)} CTN`} hint="Sold, damaged and taken out" />
        <KpiCard icon={Scale} tone={net < 0 ? "yellow" : "slate"} label="Net change" value={`${net > 0 ? "+" : ""}${one(net)} CTN`} hint="In minus out" />
      </div>

      <nav className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="Movement type">
        {pills.map((p) => {
          const active = (sp.type ?? "") === p.key;
          return (
            <Link key={p.key || "all"} href={link({ type: p.key || undefined, page: undefined })} aria-current={active ? "page" : undefined} className={cn("inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition", active ? "border-navy-700 bg-navy-700 text-white" : "border-line bg-white text-slate-600 hover:border-navy-200 hover:text-slate-900")}>
              {p.label}
              <span className={cn("rounded-full px-1.5 text-xs font-semibold", active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600")}>{p.n}</span>
            </Link>
          );
        })}
      </nav>

      <form method="get" className="card card-pad mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_auto_auto_auto]">
        {sp.type && <input type="hidden" name="type" value={sp.type} />}
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input name="q" defaultValue={q} placeholder="Product, code or document number" className="input pl-9" aria-label="Search" />
        </div>
        <select name="location" defaultValue={sp.location ?? ""} className="input" aria-label="Location">
          <option value="">All locations</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
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
          <>
            <div className={cn("hidden border-b border-line bg-slate-50/60 px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 lg:grid lg:items-center lg:gap-x-4", COLS)} aria-hidden>
              <span>Time</span>
              <span>Product</span>
              <span>What happened</span>
              <span className="text-right">Change</span>
              <span className="text-right">Stock after</span>
              {showCost && <span className="text-right">Unit cost</span>}
              <span>Document</span>
              <span>Done by</span>
            </div>
            {groups.map((g) => (
              <section key={g.key} aria-label={dayTitle(g.key, today, yesterday)}>
                <h2 className="border-b border-line bg-slate-50/90 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 sm:px-5">{dayTitle(g.key, today, yesterday)}</h2>
                <ul>
                  {g.rows.map((m) => {
                    const t = MOVEMENT_LABELS[m.type]!;
                    const neg = m.quantity.isNegative();
                    const doc = documentHref(m.referenceType, m.referenceId);
                    const pk = largestPack(m.product.units.map((u) => ({ symbol: u.unit.symbol, factor: u.factor })));
                    const sym = m.product.baseUnit.symbol;
                    return (
                      <li key={m.id} className={cn("grid grid-cols-2 items-center gap-x-4 gap-y-2 border-b border-line/70 px-4 py-3 last:border-b-0 sm:px-5", COLS)}>
                        <span className="text-xs font-medium tabular-nums text-slate-500 lg:text-sm" title={`${dayTitle(g.key, today, yesterday)}, ${timeOf(m.createdAt)}`}>
                          {timeOf(m.createdAt)}
                        </span>
                        <div className="col-span-2 flex min-w-0 items-center gap-3 lg:col-span-1">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-white">
                            {m.product.image ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={`/api/product-image/${m.product.id}?size=thumb&v=${m.product.image.updatedAt.getTime()}`} alt="" loading="lazy" className="h-full w-full object-contain" />
                            ) : (
                              <ImageOff size={14} className="text-slate-300" />
                            )}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-slate-900">{m.product.name}</span>
                            <span className="block truncate font-mono text-xs text-slate-500">{m.product.sku}</span>
                          </span>
                        </div>
                        <div className="col-span-2 min-w-0 lg:col-span-1">
                          <span className={t.badge}>{t.label}</span>
                          {m.reason && <span className="mt-0.5 block truncate text-xs text-slate-500" title={m.reason}>{m.reason}</span>}
                        </div>
                        <span className={cn("inline-flex items-center gap-1 text-sm font-bold tabular-nums lg:justify-end", neg ? "text-brand-red-dark" : "text-emerald-700")}>
                          {neg ? <ArrowUpFromLine size={14} /> : <ArrowDownToLine size={14} />}
                          {neg ? "−" : "+"}
                          {qtyText(Math.abs(num(m.quantity)), pk, sym).main}
                        </span>
                        <span className="text-sm tabular-nums text-slate-800 lg:text-right">
                          {qtyText(num(m.newQty), pk, sym).main}
                          <span className="block text-xs text-slate-400">was {qtyText(num(m.previousQty), pk, sym).main}</span>
                        </span>
                        {showCost && <span className="hidden text-right text-sm tabular-nums text-slate-700 lg:block">{m.unitCost ? formatMoney(m.unitCost, { ...currency, decimals: Math.max(currency.decimals, 2) }) : "—"}</span>}
                        <span className="min-w-0 truncate text-sm">
                          {doc ? (
                            <Link href={doc} className="font-medium text-navy-700 hover:underline">
                              {m.referenceNo}
                            </Link>
                          ) : (
                            <span className="text-slate-500">{m.referenceNo ?? "—"}</span>
                          )}
                        </span>
                        <span className="min-w-0 text-sm text-slate-700">
                          <span className="block truncate">{m.user.name}</span>
                          {locations.length > 1 && <span className="block truncate text-xs text-slate-400">{m.location.name}</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </>
        )}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-slate-600">
            <span>
              Page {page} of {pages} · {fmtQty(total)} movements
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
      </div>
    </>
  );
}
