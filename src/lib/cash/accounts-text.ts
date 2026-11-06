// The "where to pay" block of a payment reminder, built from the shop's real accounts (Cash & Accounts), so the accounts
// are kept in one place only. Bank accounts first, then mobile money; the till and closed accounts never appear, and an
// account with no number is left out (a customer cannot pay into it).
export type TextAccount = { method: "CASH" | "MOBILE_MONEY" | "BANK"; name: string; accountNumber: string | null; holderName: string | null; isDefault: boolean; status: "ACTIVE" | "INACTIVE" };

/**
 * CRDB BANK
 * Jina: ABEL JACOB KIJYOMBO
 * Akaunti: 0152841983800
 *
 * M-PESA
 * Jina: Abely Jacob
 * Namba: 37453908
 */
export function paymentAccountsText(accounts: TextAccount[]): string {
  const rank = { BANK: 0, MOBILE_MONEY: 1, CASH: 2 } as const;
  return accounts
    .filter((a) => a.status === "ACTIVE" && a.method !== "CASH" && a.accountNumber?.trim())
    .map((a, i) => ({ a, i }))
    .sort((x, y) => rank[x.a.method] - rank[y.a.method] || Number(y.a.isDefault) - Number(x.a.isDefault) || x.i - y.i)
    .map(({ a }) => [a.name.trim().toUpperCase(), ...(a.holderName?.trim() ? [`Jina: ${a.holderName.trim()}`] : []), `${a.method === "BANK" ? "Akaunti" : "Namba"}: ${a.accountNumber!.trim()}`].join("\n"))
    .join("\n\n");
}
