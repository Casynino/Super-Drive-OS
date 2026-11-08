import Link from "next/link";
import { ImageOff } from "lucide-react";
import { StatusBadge } from "@/components/ui";
import type { RecordStatus } from "@/generated/prisma/client";
import type { Pack } from "@/lib/qty";
import HeroStockPanel, { type HeroStock } from "./HeroStockPanel";

export type { HeroStock };

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
  stockHref,
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
  /** where this product's stock is handled (add, remove, count, movements) */
  stockHref?: string;
}) {
  // badges in the header do not depend on how the numbers are written
  const out = stock ? stock.available === 0 : false;
  const low = stock ? !out && minStock > 0 && stock.available <= minStock : false;

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
            Sells for <span className="text-lg font-semibold text-slate-900">{price}</span>
            {wholesale && <span className="ml-3 text-slate-500">Wholesale {wholesale}</span>}
          </p>
        </div>
      </div>

      {stock && <HeroStockPanel stock={stock} pack={pack} baseSymbol={baseSymbol} minStock={minStock} stockHref={stockHref} />}
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
