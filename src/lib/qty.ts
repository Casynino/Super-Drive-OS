// Carton-first quantities. Stock is always KEPT in the base unit (pieces); these helpers only decide what people SEE first.
//   125 PCS with 12 per carton  ->  "10 CTN + 5 PCS"  (and "125 PCS" as the small secondary text)
// Pure functions: no database, safe on the server and in the browser.

export type Pack = { symbol: string; factor: number };
type Loose = { symbol: string; factor: string | number | { toString(): string } };

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });
export const fmtQty = (n: number) => nf.format(n);

/** The biggest packaging unit of a product (the carton), or null when it only has its base unit. */
export function largestPack(units: Loose[]): Pack | null {
  const packs = units.map((u) => ({ symbol: u.symbol, factor: Number(u.factor.toString()) })).filter((u) => Number.isFinite(u.factor) && u.factor > 1);
  return packs.sort((a, b) => b.factor - a.factor)[0] ?? null;
}

/**
 * A base quantity written carton-first.
 * `main` is the main text ("10 CTN + 5 PCS", "5 PCS", "20 CTN"); `pieces` is the equivalent in the base unit, only when it adds something.
 */
export function qtyText(base: number, pack: Pack | null, baseSymbol: string): { main: string; pieces: string | null } {
  if (!pack || !Number.isFinite(base)) return { main: `${fmtQty(base)} ${baseSymbol}`.trim(), pieces: null };
  const whole = Math.floor(base / pack.factor + 1e-9);
  const rest = Number((base - whole * pack.factor).toFixed(3));
  if (whole === 0) return { main: `${fmtQty(rest)} ${baseSymbol}`, pieces: null };
  const main = rest === 0 ? `${fmtQty(whole)} ${pack.symbol}` : `${fmtQty(whole)} ${pack.symbol} + ${fmtQty(rest)} ${baseSymbol}`;
  return { main, pieces: `${fmtQty(base)} ${baseSymbol}` };
}

/** Packs of a quantity as a plain number (7.5 cartons), for totals across products. */
export const inPacks = (base: number, pack: Pack | null) => (pack ? base / pack.factor : base);
