"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, ChevronRight, CircleCheck, Clock, Package, ReceiptText, Undo2, Truck, Handshake, CalendarCheck, HandCoins } from "lucide-react";
import { cn } from "@/lib/utils";

export type AttentionItem = {
  id: string;
  group: "decisions" | "money" | "stock";
  tone: "red" | "amber" | "blue";
  icon: "returns" | "expense" | "closing" | "debt" | "reseller" | "stock" | "shipment" | "clock";
  title: string;
  detail: string;
  main?: string;
  sub?: string;
  href: string;
};

const ICONS = { returns: Undo2, expense: ReceiptText, closing: CalendarCheck, debt: HandCoins, reseller: Handshake, stock: Package, shipment: Truck, clock: Clock };
const BAR = { red: "bg-brand-red", amber: "bg-oil-400", blue: "bg-sky-500" };
const ICON_TONE = { red: "text-brand-red-dark", amber: "text-yellow-700", blue: "text-sky-600 dark:text-sky-300" };
const TABS = [
  { key: "all", label: "All" },
  { key: "decisions", label: "Decisions" },
  { key: "money", label: "Money" },
  { key: "stock", label: "Stock" },
] as const;

/** The list of things that need the owner, with a filter. Each row says what it is, why, and how much is at stake. */
export default function AttentionPanel({ items }: { items: AttentionItem[] }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("all");
  const shown = tab === "all" ? items : items.filter((i) => i.group === tab);
  const count = (k: string) => (k === "all" ? items.length : items.filter((i) => i.group === k).length);

  return (
    <section id="attention" className="card scroll-mt-20 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5 sm:px-4">
        <div className="flex gap-1 overflow-x-auto [scrollbar-width:none]" role="tablist" aria-label="Filter">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium transition", tab === t.key ? "bg-navy-700 text-white" : "text-slate-600 hover:bg-slate-100")}
            >
              {t.label}
              <span className={cn("rounded-full px-1.5 text-[11px] leading-[18px]", tab === t.key ? "bg-white/20" : "bg-slate-100 text-slate-500")}>{count(t.key)}</span>
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <div className="flex items-center gap-3 px-4 py-6 text-sm text-emerald-700">
          <CircleCheck size={20} />
          {items.length === 0 ? "Nothing needs your attention right now." : "Nothing here."}
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {shown.map((i) => {
            const Icon = ICONS[i.icon] ?? AlertTriangle;
            return (
              <li key={i.id}>
                <Link href={i.href} className="group relative flex items-center gap-3 px-3 py-3 transition hover:bg-slate-50 sm:px-4">
                  <span className={cn("absolute inset-y-2 left-0 w-[3px] rounded-r", BAR[i.tone])} aria-hidden />
                  <Icon size={18} className={cn("ml-1 shrink-0", ICON_TONE[i.tone])} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-900">{i.title}</span>
                    <span className="block text-[13px] leading-snug text-slate-500">{i.detail}</span>
                  </span>
                  {(i.main || i.sub) && (
                    <span className="hidden shrink-0 text-right sm:block">
                      {i.main && <span className="block text-sm font-semibold tabular-nums text-slate-900">{i.main}</span>}
                      {i.sub && <span className="block text-[11px] tabular-nums text-slate-500">{i.sub}</span>}
                    </span>
                  )}
                  <ChevronRight size={16} className="shrink-0 text-slate-400 transition group-hover:translate-x-0.5" />
                </Link>
                {(i.main || i.sub) && (
                  <p className="-mt-1.5 px-4 pb-2.5 pl-[3.1rem] text-xs font-medium tabular-nums text-slate-600 sm:hidden">
                    {i.main}
                    {i.sub && <span className="ml-2 text-slate-400">{i.sub}</span>}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
