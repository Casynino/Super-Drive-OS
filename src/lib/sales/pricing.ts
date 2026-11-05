import type { Prisma } from "@/generated/prisma/client";
import type { ResolvedLine } from "@/lib/inventory/lines";

type Dec = Prisma.Decimal;

/** Customer types that get wholesale prices (when a wholesale price exists). */
export const WHOLESALE_TYPES = ["WHOLESALE", "DISTRIBUTOR"] as const;
export const isWholesaleType = (type: string | null | undefined) => (WHOLESALE_TYPES as readonly string[]).includes(type ?? "");

type PriceInputs = Pick<ResolvedLine, "factor" | "basePrice" | "baseWholesale" | "unitSelling" | "unitWholesale">;

/**
 * The official price for ONE entered unit (e.g. one carton).
 * Retail: the unit's own price if set, otherwise base price x factor.
 * Wholesale: same idea with wholesale prices, falling back to the retail price when none is set.
 */
export function listPrice(l: PriceInputs, wholesale: boolean): Dec {
  const retail = l.unitSelling ?? l.basePrice.mul(l.factor);
  if (!wholesale) return retail;
  const w = l.unitWholesale ?? (l.baseWholesale ? l.baseWholesale.mul(l.factor) : null);
  return w ?? retail;
}
