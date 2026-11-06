import Link from "next/link";
import { ImageOff } from "lucide-react";
import { qtyText, type Pack, type UnitMode } from "@/lib/qty";
import { cn } from "@/lib/utils";

export type ProductLevel = {
  id: string;
  name: string;
  sku: string;
  imageV: number | null;
  minStock: number;
  /** every piece this product has ever had a number for */
  total: number;
  available: number;
  reseller: number;
  damaged: number;
  sold: number;
  /** the products list adds these: category and brand, the selling price as text, and whether the product is switched off */
  subtitle?: string | null;
  price?: string | null;
  inactive?: boolean;
  /** carton-first: the biggest pack and the base unit's label, so numbers read as cartons */
  pack?: Pack | null;
  baseSymbol?: string;
};

/**
 * One product's level at a glance: the big number is what is in the shop now, the bar shows where every piece of it went
 * (in the shop, with resellers, damaged, sold). Pressing the card shows only that product's pieces.
 */
export default function ProductLevelCard({ p, href, active, showStock = true, mode = "ctn" }: { p: ProductLevel; href: string; active?: boolean; /** false for people who may not see stock: only the product and its price */ showStock?: boolean; /** the CTN | PCS switch */ mode?: UnitMode }) {
  const out = p.available === 0;
  const low = !out && p.minStock > 0 && p.available <= p.minStock;
  const pct = (n: number) => (p.total > 0 ? (n / p.total) * 100 : 0);
  const fmt = (n: number) => qtyText(n, p.pack ?? null, p.baseSymbol ?? "", mode).main;
  const segments = [
    { n: p.available, cls: out ? "bg-brand-red" : low ? "bg-oil-400" : "bg-emerald-500", label: "in the shop" },
    { n: p.reseller, cls: "bg-blue-500", label: "with resellers" },
    { n: p.damaged, cls: "bg-brand-red", label: "damaged" },
    { n: p.sold, cls: "bg-slate-300", label: "sold" },
  ];
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn("card block px-4 py-3.5 transition hover:-translate-y-0.5 hover:border-navy-200 hover:shadow-md", active && "border-navy-500 ring-1 ring-navy-500/40")}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-white">
          {p.imageV ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/product-image/${p.id}?size=thumb&v=${p.imageV}`} alt="" loading="lazy" className="h-full w-full object-contain" />
          ) : (
            <ImageOff size={16} className="text-slate-300" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{p.name}</p>
          <p className="truncate text-xs text-slate-500">{p.sku}</p>
          {p.subtitle && <p className="truncate text-xs text-slate-400">{p.subtitle}</p>}
        </div>
        {p.inactive ? <span className="badge-gray shrink-0">Off</span> : out ? <span className="badge-red shrink-0">Out</span> : low ? <span className="badge-yellow shrink-0">Low</span> : null}
      </div>

      {showStock ? (
        <>
        <div className="mt-3 flex items-baseline justify-between gap-2">
          <p className="text-2xl font-bold leading-none tracking-tight text-slate-900">
            {fmt(p.available)}
            <span className="ml-1.5 text-xs font-medium text-slate-500">in the shop</span>
          </p>
          <p className="text-xs text-slate-500">{fmt(p.total)} in all</p>
        </div>

        <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={segments.filter((s) => s.n > 0).map((s) => `${s.n} ${s.label}`).join(", ")}>
          {segments.map((s) => (s.n > 0 ? <span key={s.label} className={s.cls} style={{ width: `${pct(s.n)}%` }} title={`${s.n} ${s.label}`} /> : null))}
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-slate-500">
          <p className="min-w-0 truncate">
            {fmt(p.sold)} sold
            {p.reseller > 0 && <> · {fmt(p.reseller)} with resellers</>}
            {p.damaged > 0 && <> · <span className="text-brand-red-dark">{fmt(p.damaged)} damaged</span></>}
          </p>
          {p.price && <p className="shrink-0 font-semibold text-slate-700">{p.price}</p>}
        </div>
        </>
      ) : (
        p.price && <p className="mt-3 text-lg font-bold text-slate-900">{p.price}</p>
      )}
    </Link>
  );
}
