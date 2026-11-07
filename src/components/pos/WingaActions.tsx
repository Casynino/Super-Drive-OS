"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowUpRight, HandCoins, ShoppingBag, Undo2 } from "lucide-react";
import CollectModal from "@/components/pos/CollectModal";
import ReturnModal from "@/components/pos/ReturnModal";
import type { TillSummary } from "@/app/(app)/till/actions";
import type { PayAccount } from "@/lib/sales/types";
import { cn } from "@/lib/utils";

const base = "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition";
const primary = "border-navy-700 bg-navy-700 text-white hover:bg-navy-800";
const quiet = "border-line bg-white text-slate-700 hover:border-navy-200 hover:bg-slate-50";

/**
 * Small buttons for a Winga: Sell (opens the till on him), Collect payment and Return goods (pop-ups, nothing leaves the page).
 * Used on the till, the Winga list and the Winga profile.
 */
export default function WingaActions({ customerId, name, sellHref, canCollect, canReturn, accounts, currency, onDone, emphasizeCollect, short, openHref, openLabel, openNewTab }: { customerId: string; name: string; sellHref?: string; canCollect?: boolean; canReturn?: boolean; accounts: PayAccount[]; currency: { symbol: string; decimals: number }; onDone?: (s: TillSummary) => void; emphasizeCollect?: boolean; short?: boolean; openHref?: string; openLabel?: string; openNewTab?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState<"collect" | "return" | null>(null);
  const done = (s: TillSummary) => {
    onDone?.(s);
    router.refresh();
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {sellHref && (
          <Link href={sellHref} className={cn(base, primary)}>
            <ShoppingBag size={13} /> Sell
          </Link>
        )}
        {canCollect && (
          <button type="button" className={cn(base, emphasizeCollect ? primary : quiet)} onClick={() => setOpen("collect")}>
            <HandCoins size={13} /> {short ? "Collect" : "Collect payment"}
          </button>
        )}
        {canReturn && (
          <button type="button" className={cn(base, quiet)} onClick={() => setOpen("return")}>
            <Undo2 size={13} /> {short ? "Return" : "Return goods"}
          </button>
        )}
        {openHref && (
          <Link href={openHref} target={openNewTab ? "_blank" : undefined} rel={openNewTab ? "noopener" : undefined} className={cn(base, quiet)} title="Open the full page: performance, orders, payments">
            <ArrowUpRight size={13} /> {openLabel ?? "Open"}
          </Link>
        )}
      </div>
      {canCollect && open === "collect" && <CollectModal open onClose={() => setOpen(null)} customerId={customerId} customerName={name} accounts={accounts} currency={currency} onDone={done} />}
      {canReturn && open === "return" && <ReturnModal open onClose={() => setOpen(null)} customerId={customerId} customerName={name} currency={currency} onDone={done} />}
    </>
  );
}
