import { Prisma } from "@/generated/prisma/client";
import type { DecimalLike } from "@/lib/units";

const D = Prisma.Decimal;

export type CurrencyConfig = { code: string; symbol: string; decimals: number };

export const DEFAULT_CURRENCY: CurrencyConfig = { code: "TZS", symbol: "TSh", decimals: 0 };

export function formatMoney(value: DecimalLike | null | undefined, currency: CurrencyConfig = DEFAULT_CURRENCY) {
  if (value === null || value === undefined || value === "") return "—";
  const n = new D(value);
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: currency.decimals,
    maximumFractionDigits: currency.decimals,
  }).format(Number(n.toFixed(currency.decimals)));
  return `${currency.symbol}\u00A0${formatted}`; // non-breaking space so amounts never wrap
}

export function formatQuantity(value: DecimalLike, symbol?: string) {
  const n = new D(value);
  const s = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(Number(n));
  return symbol ? `${s} ${symbol}` : s;
}

/**
 * Parses a user-typed money amount. Returns null when invalid, negative, or has more decimals
 * than the currency allows (so we never silently round a price).
 */
export function parseMoney(raw: string | null | undefined, decimals: number): Prisma.Decimal | null {
  if (raw === null || raw === undefined) return null;
  const cleaned = raw.trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = new D(cleaned);
  if (n.decimalPlaces() > decimals) return null;
  if (n.gte(new D("1e12"))) return null;
  return n;
}
