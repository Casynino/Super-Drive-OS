// Carton-first quantities. Stock is always KEPT in the base unit (pieces); these helpers only decide what people SEE first.
//   125 PCS with 12 per carton  ->  "10 CTN + 5 PCS"  (and "125 PCS" as the small secondary text)
// Pure functions: no database, safe on the server and in the browser.

export type Pack = { symbol: string; factor: number };
/** How quantities are shown: cartons (the default) or pieces. Each product has its own CTN | PCS switch. */
export type UnitMode = "ctn" | "pcs";
type Loose = { symbol: string; factor: string | number | { toString(): string } };

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });
export const fmtQty = (n: number) => nf.format(n);

/** The biggest packaging unit of a product (the carton), or null when it only has its base unit. */
export function largestPack(units: Loose[]): Pack | null {
  const packs = units.map((u) => ({ symbol: u.symbol, factor: Number(u.factor.toString()) })).filter((u) => Number.isFinite(u.factor) && u.factor > 1);
  return packs.sort((a, b) => b.factor - a.factor)[0] ?? null;
}

/**
 * A base quantity written in cartons only, never "cartons + pieces" (Nino: "don't mix PCS and CTN").
 * 120 PCS at 12 per carton -> "10 CTN"; a leftover shows as a fraction (125 -> "10.42 CTN") so nothing is hidden; a product with no pack keeps its own unit.
 * `pieces` is kept in the result for callers but is always null now.
 */
export function qtyText(base: number, pack: Pack | null, baseSymbol: string, mode: UnitMode = "ctn"): { main: string; pieces: string | null } {
  if (!pack || mode === "pcs" || !Number.isFinite(base)) return { main: `${fmtQty(base)} ${baseSymbol}`.trim(), pieces: null };
  const packs = base / pack.factor;
  return { main: `${fmtQty(Number(packs.toFixed(2)))} ${pack.symbol}`, pieces: null };
}

/** What one carton holds, shown beside a product: "1 CTN = 12 PCS". */
export const packNote = (pack: Pack | null, baseSymbol: string) => (pack ? `1 ${pack.symbol} = ${fmtQty(pack.factor)} ${baseSymbol}` : null);

/** Packs of a quantity as a plain number (7.5 cartons), for totals across products. */
export const inPacks = (base: number, pack: Pack | null) => (pack ? base / pack.factor : base);
