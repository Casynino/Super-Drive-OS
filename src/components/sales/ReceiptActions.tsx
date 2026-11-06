"use client";

import { useEffect, useRef } from "react";
import BackLink from "@/components/BackLink";
import Link from "next/link";
import { Printer } from "lucide-react";
import { logReceiptReprint } from "@/app/(app)/sales/[id]/receipt/actions";

/** Print buttons for a receipt. Opening a reprint records it once (an audit entry), then the receipt is marked COPY. */
export default function ReceiptActions({ saleId, paper, isCopy, backHref }: { saleId: string; paper: "80" | "a4"; isCopy: boolean; backHref: string }) {
  const logged = useRef(false);
  useEffect(() => {
    if (isCopy && !logged.current) {
      logged.current = true;
      void logReceiptReprint(saleId);
    }
  }, [isCopy, saleId]);
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
      <BackLink href={backHref} className="py-1 text-sm text-slate-500 hover:text-navy-700">
        ← Back to the sale
      </BackLink>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-white p-0.5 ring-1 ring-line" role="group" aria-label="Paper size">
          <Link href={`/sales/${saleId}/receipt?paper=80${isCopy ? "" : "&first=1"}`} className={`rounded-md px-3 py-1.5 text-sm ${paper === "80" ? "bg-navy-700 text-white" : "text-slate-600 hover:bg-slate-50"}`}>
            80 mm receipt
          </Link>
          <Link href={`/sales/${saleId}/receipt?paper=a4${isCopy ? "" : "&first=1"}`} className={`rounded-md px-3 py-1.5 text-sm ${paper === "a4" ? "bg-navy-700 text-white" : "text-slate-600 hover:bg-slate-50"}`}>
            A4 / PDF
          </Link>
        </div>
        <button type="button" className="btn-primary" onClick={() => window.print()}>
          <Printer size={16} /> {paper === "a4" ? "Print or save as PDF" : "Print receipt"}
        </button>
      </div>
    </div>
  );
}
