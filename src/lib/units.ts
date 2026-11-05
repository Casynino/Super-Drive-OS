import { Prisma } from "@/generated/prisma/client";

const D = Prisma.Decimal;
export type DecimalLike = Prisma.Decimal | string | number;

/** Stock is stored with 3 decimals (litres). Anything finer would be silently rounded, so we reject it. */
export const STOCK_SCALE = 3;

export type QuantityResult = { ok: true; value: Prisma.Decimal } | { ok: false; error: string };

/** Validates a quantity typed by a user for a unit (must be > 0, whole number unless the unit allows decimals). */
export function validateQuantity(raw: DecimalLike, allowsDecimal: boolean): QuantityResult {
  let q: Prisma.Decimal;
  try {
    q = new D(raw);
  } catch {
    return { ok: false, error: "Enter a valid quantity." };
  }
  if (!q.isFinite()) return { ok: false, error: "Enter a valid quantity." };
  if (q.lte(0)) return { ok: false, error: "Quantity must be greater than zero." };
  if (!allowsDecimal && !q.isInteger()) return { ok: false, error: "This unit cannot be sold in fractions." };
  if (q.decimalPlaces() > STOCK_SCALE) return { ok: false, error: `Use at most ${STOCK_SCALE} decimal places.` };
  return { ok: true, value: q };
}

/**
 * Converts a quantity in a packaging unit into base units.
 * Example: 2 cartons x factor 12 = 24 bottles.
 * Returns an error instead of rounding when the result would not fit stock precision.
 */
export function toBaseQuantity(quantity: DecimalLike, factor: DecimalLike): QuantityResult {
  const f = new D(factor);
  if (!f.isFinite() || f.lte(0)) return { ok: false, error: "Packaging factor must be greater than zero." };
  const base = new D(quantity).mul(f);
  if (base.decimalPlaces() > STOCK_SCALE) {
    return { ok: false, error: "This quantity does not convert to a whole stock amount." };
  }
  return { ok: true, value: base };
}

/** Price of one packaging unit: explicit override when set, otherwise base price x factor. */
export function packagePrice(basePrice: DecimalLike, factor: DecimalLike, override?: DecimalLike | null) {
  if (override !== null && override !== undefined) return new D(override);
  return new D(basePrice).mul(new D(factor));
}
