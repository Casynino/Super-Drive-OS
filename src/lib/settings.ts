import { cache } from "react";
import { db } from "@/lib/db";
import { paymentAccountsText } from "@/lib/cash/accounts-text";
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

/**
 * `paymentAccounts` is the "where to pay" text copied into payment reminders: built from the bank and mobile-money accounts in
 * Cash & Accounts (those with a number). Only when there are none does the free text saved in Settings (`paymentAccountsManual`) apply.
 */
export type BusinessProfile = { name: string; phone: string; address: string; creditTermsDays: number; paymentAccounts: string; paymentAccountsManual: string; paymentAccountsSource: "accounts" | "text" | "none" };

const text = (v: unknown) => (typeof v === "string" ? v : "");

/** Name, phone, address (printed on receipts) and the default credit period in days. */
export const getBusinessProfile = cache(async (): Promise<BusinessProfile> => {
  const rows = await db.setting.findMany({ where: { key: { in: ["businessName", "businessPhone", "businessAddress", "creditTermsDays", "paymentAccounts"] } } });
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const days = Number(m.get("creditTermsDays"));
  const place = await db.location.findFirst({ where: { isDefault: true }, select: { id: true } });
  const accounts = place ? await db.cashAccount.findMany({ where: { locationId: place.id, method: { in: ["BANK", "MOBILE_MONEY"] }, status: "ACTIVE", accountNumber: { not: null } }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] }) : [];
  const built = paymentAccountsText(accounts);
  const manual = text(m.get("paymentAccounts"));
  return {
    name: text(m.get("businessName")) || "Super Drive Oil",
    phone: text(m.get("businessPhone")),
    address: text(m.get("businessAddress")),
    creditTermsDays: Number.isInteger(days) && days >= 0 && days <= 365 ? days : 30,
    paymentAccounts: built || manual,
    paymentAccountsManual: manual,
    paymentAccountsSource: built ? "accounts" : manual ? "text" : "none",
  };
});
