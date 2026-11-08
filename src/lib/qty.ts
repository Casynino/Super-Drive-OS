// Carton-first quantities. Stock is always KEPT in the base unit (pieces); these helpers only decide what people SEE first.
//   125 PCS with 12 per carton  ->  "10 CTN + 5 PCS"
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
 * A base quantity as people say it: whole cartons, and the loose pieces of an opened carton after them (Nino 2026-11-08: "5 cartons and 2 pcs, just like that").
 *   120 PCS at 12 per carton -> "10 CTN"      125 -> "10 CTN + 5 PCS"      5 -> "5 PCS"
 * In PCS mode (the product's CTN | PCS switch) and for a product with no pack, the plain piece count. `pieces` is kept in the result for callers but is always null.
 */
export function qtyText(base: number, pack: Pack | null, baseSymbol: string, mode: UnitMode = "ctn"): { main: string; pieces: string | null } {
  if (!pack || mode === "pcs" || !Number.isFinite(base)) return { main: `${fmtQty(base)} ${baseSymbol}`.trim(), pieces: null };
  const sign = base < 0 ? "-" : "";
  const abs = Math.abs(base);
  const cartons = Math.floor(abs / pack.factor + 1e-9);
  const rest = Number((abs - cartons * pack.factor).toFixed(3));
  if (cartons === 0) return { main: `${sign}${fmtQty(rest)} ${baseSymbol}`, pieces: null };
  if (rest === 0) return { main: `${sign}${fmtQty(cartons)} ${pack.symbol}`, pieces: null };
  return { main: `${sign}${fmtQty(cartons)} ${pack.symbol} + ${fmtQty(rest)} ${baseSymbol}`, pieces: null };
}

/** What one carton holds, shown beside a product: "1 CTN = 12 PCS". */
export const packNote = (pack: Pack | null, baseSymbol: string) => (pack ? `1 ${pack.symbol} = ${fmtQty(pack.factor)} ${baseSymbol}` : null);

/** Packs of a quantity as a plain number (7.5 cartons), for totals across products. */
export const inPacks = (base: number, pack: Pack | null) => (pack ? base / pack.factor : base);
