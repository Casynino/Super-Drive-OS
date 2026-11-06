"use client";

import { cn } from "@/lib/utils";
import type { PayAccount } from "@/lib/sales/types";

const KIND = { CASH: "Cash", MOBILE_MONEY: "Mobile money", BANK: "Bank" } as const;

/**
 * "Paid by": one button per account (Cash, M-PESA, CRDB Bank, NMB Bank, ...), each with its number, so the money is
 * written into the account it really went to. The payment method follows from the account chosen.
 */
export default function AccountButtons({ accounts, value, onChange, name = "Paid by" }: { accounts: PayAccount[]; value: string; onChange: (id: string) => void; name?: string }) {
  return (
    <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label={name}>
      {accounts.map((a) => {
        const on = a.id === value;
        return (
          <button key={a.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(a.id)} className={cn("rounded-lg border px-2.5 py-2 text-left transition", on ? "border-navy-600 bg-navy-50 text-navy-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")}>
            <span className="block text-sm font-medium leading-tight">{a.name}</span>
            <span className="block truncate text-[11px] text-slate-500">
              {KIND[a.method]}
              {a.accountNumber ? ` · ${a.accountNumber}` : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}
