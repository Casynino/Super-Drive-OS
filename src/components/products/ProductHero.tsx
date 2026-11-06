import Link from "next/link";
import { ImageOff } from "lucide-react";
import { StatusBadge } from "@/components/ui";
import type { RecordStatus } from "@/generated/prisma/client";
import { qtyText, type Pack, type UnitMode } from "@/lib/qty";

export type HeroStock = { available: number; reseller: number; sold: number; returned: number; damaged: number; missing: number };

/**
 * The top of a product page: picture, name, codes and prices, then where its pieces are (shelf, resellers, sold, returned, damaged)
 * with one bar that shows the split. Stock is left out for people who may not see it.
 */
export default function ProductHero({
  id,
  name,
  sku,
  subtitle,
  status,
  imageV,
  price,
  wholesale,
  minStock,
  stock,
  pack = null,
  baseSymbol = "",
  mode = "ctn",
}: {
  id: string;
  name: string;
  sku: string;
  subtitle: string;
  status: RecordStatus;
  imageV: number | null;
  price: string;
  wholesale: string | null;
  minStock: number;
  stock: HeroStock | null;
  /** cartons first: the biggest pack and the base unit's label */
  pack?: Pack | null;
  baseSymbol?: string;
  mode?: UnitMode;
}) {
  const fmt = (n: number) => qtyText(n, pack, baseSymbol, mode);
  const total = stock ? stock.available + stock.reseller + stock.sold + stock.damaged : 0;
  const out = stock ? stock.available === 0 : false;
  const low = stock ? !out && minStock > 0 && stock.available <= minStock : false;
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  const tiles = stock
    ? [
        { k: "In the shop", v: stock.available, tone: out ? "text-brand-red-dark" : low ? "text-yellow-700" : "text-emerald-700" },
        { k: "With resellers", v: stock.reseller, tone: "text-blue-700" },
        { k: "Sold", v: stock.sold, tone: "text-slate-900" },
        { k: "Returned", v: stock.returned, tone: "text-slate-900" },
        { k: "Damaged", v: stock.damaged, tone: stock.damaged > 0 ? "text-brand-red-dark" : "text-slate-900" },
      ]
    : [];
  const segments = stock
    ? [
        { n: stock.available, cls: out ? "bg-brand-red" : low ? "bg-oil-400" : "bg-emerald-500", label: "in the shop" },
        { n: stock.reseller, cls: "bg-blue-500", label: "with resellers" },
        { n: stock.damaged, cls: "bg-brand-red", label: "damaged" },
        { n: stock.sold, cls: "bg-slate-300", label: "sold" },
      ]
    : [];

  return (
    <section className="card mb-5 overflow-hidden">
      <div className="flex flex-wrap items-start gap-5 p-5">
        <span className="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-white">
          {imageV ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/product-image/${id}?size=thumb&v=${imageV}`} alt="" className="h-full w-full object-contain" />
          ) : (
            <ImageOff size={26} className="text-slate-300" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{name}</h1>
              <p className="mt-0.5 text-sm text-slate-500">
                <span className="font-mono">{sku}</span>
                {subtitle && <> · {subtitle}</>}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {out && <span className="badge-red">Out of stock</span>}
              {low && <span className="badge-yellow">Low</span>}
              <StatusBadge status={status} />
            </div>
          </div>
          <p className="mt-3 text-sm text-slate-600">
            Sells for <span className="text-lg font-bold text-slate-900">{price}</span>
            {wholesale && <span className="ml-3 text-slate-500">Wholesale {wholesale}</span>}
          </p>
        </div>
      </div>

      {stock && (
        <div className="border-t border-line px-5 pb-5 pt-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5">
            {tiles.map((t) => (
              <div key={t.k}>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{t.k}</dt>
                <dd className={`mt-0.5 text-2xl font-bold leading-tight ${t.tone}`}>{fmt(t.v).main}</dd>
                {fmt(t.v).pieces && <dd className="text-xs text-slate-500">{fmt(t.v).pieces}</dd>}
              </div>
            ))}
          </dl>
          <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={segments.filter((s) => s.n > 0).map((s) => `${s.n} ${s.label}`).join(", ")}>
            {segments.map((s) => (s.n > 0 ? <span key={s.label} className={s.cls} style={{ width: `${pct(s.n)}%` }} title={`${s.n} ${s.label}`} /> : null))}
          </div>
          <p className="mt-1.5 flex flex-wrap justify-between gap-2 text-xs text-slate-500">
            <span>{fmt(total).main} in all{minStock > 0 && <> · reorder when {fmt(minStock).main} or less is left</>}</span>
            {stock.missing > 0 && <span className="text-yellow-700">{fmt(stock.missing).main} marked missing</span>}
          </p>
        </div>
      )}
    </section>
  );
}

export function ProductTabs({ id, tab, pieces }: { id: string; tab: "pieces" | "details"; pieces: number | null }) {
  const items = [
    ...(pieces !== null ? [{ key: "pieces" as const, label: "Pieces", n: pieces }] : []),
    { key: "details" as const, label: "Details and prices", n: null as number | null },
  ];
  return (
    <nav className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="Product sections">
      {items.map((t) => {
        const active = tab === t.key;
        return (
          <Link
            key={t.key}
            href={`/products/${id}?tab=${t.key}`}
            aria-current={active ? "page" : undefined}
            className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-medium transition ${active ? "border-navy-700 bg-navy-700 text-white" : "border-line bg-white text-slate-600 hover:border-navy-200 hover:text-slate-900"}`}
          >
            {t.label}
            {t.n !== null && <span className={`rounded-full px-1.5 text-xs font-semibold ${active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"}`}>{t.n}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
