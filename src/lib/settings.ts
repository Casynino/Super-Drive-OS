import { cache } from "react";
import { db } from "@/lib/db";
import { DEFAULT_CURRENCY, type CurrencyConfig } from "@/lib/money";

export const getCurrency = cache(async (): Promise<CurrencyConfig> => {
  const row = await db.setting.findUnique({ where: { key: "currency" } });
  const v = row?.value as Partial<CurrencyConfig> | null | undefined;
  if (v && typeof v.code === "string" && typeof v.symbol === "string" && typeof v.decimals === "number") {
    return { code: v.code, symbol: v.symbol, decimals: v.decimals };
  }
  return DEFAULT_CURRENCY;
});

export const getBusinessName = cache(async (): Promise<string> => {
  const row = await db.setting.findUnique({ where: { key: "businessName" } });
  return typeof row?.value === "string" ? row.value : "Super Drive Oil";
});
