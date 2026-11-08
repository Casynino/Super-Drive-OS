"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { AlertTriangle, CalendarCheck, ChevronDown, ChevronRight, CircleCheck, ClipboardList, Clock, HandCoins, Handshake, Package, PackageCheck, PackageOpen, ReceiptText, Truck, TriangleAlert, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type AttentionTab = { key: string; label: string };
export type AttentionItem = {
  id: string;
  /** which filter pill the row belongs to (one of the panel's `tabs`) */
  group: string;
  tone: "red" | "amber" | "blue";
  icon: "returns" | "expense" | "closing" | "debt" | "reseller" | "stock" | "shipment" | "clock" | "orders" | "ready" | "partial" | "issue";
  title: string;
  detail: string;
  main?: string;
  sub?: string;
  href: string;
};

const ICONS = { returns: Undo2, expense: ReceiptText, closing: CalendarCheck, debt: HandCoins, reseller: Handshake, stock: Package, shipment: Truck, clock: Clock, orders: ClipboardList, ready: PackageCheck, partial: PackageOpen, issue: TriangleAlert };
const BAR = { red: "bg-brand-red", amber: "bg-oil-400", blue: "bg-sky-500" };
const ICON_TONE = { red: "text-brand-red", amber: "text-oil-500", blue: "text-sky-500" };
/** exactly this many rows show before the list scrolls inside its box (every row has the same fixed height, so it is true on a phone too) */
const VISIBLE = 3;
/** the Director's tabs; other departments pass their own */
export const DIRECTOR_TABS: AttentionTab[] = [
  { key: "decisions", label: "Decisions" },
  { key: "money", label: "Money" },
  { key: "stock", label: "Stock" },
];

/**
 * "Needs your attention", the same on every home page and on every screen size (Nino 2026-11-08): filter pills on top, then rows (coloured bar,
 * icon, what it is and why, how much is at stake, an arrow). Three rows show; the rest scroll inside the box and the footer says how many more.
 * Pills for groups with nothing in them are not drawn.
 */
export default function AttentionPanel({ items, tabs = DIRECTOR_TABS, empty = "Nothing needs your attention right now." }: { items: AttentionItem[]; tabs?: AttentionTab[]; empty?: string }) {
  const [tab, setTab] = useState("all");
  const [scrolled, setScrolled] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const shown = tab === "all" ? items : items.filter((i) => i.group === tab);
  const count = (k: string) => (k === "all" ? items.length : items.filter((i) => i.group === k).length);
  const pills: AttentionTab[] = [{ key: "all", label: "All" }, ...tabs].filter((t) => t.key === "all" || t.key === tab || count(t.key) > 0);
  // rows still hidden below the box's bottom edge (follows the scroll position)
  const more = Math.max(0, shown.length - VISIBLE - scrolled);
  const rowHeight = () => list.current?.firstElementChild?.getBoundingClientRect().height ?? 72;

  return (
    <section id="attention" className="card scroll-mt-20 overflow-hidden rounded-2xl">
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pt-4 sm:px-5">
        <div className="flex gap-2 overflow-x-auto [scrollbar-width:none]" role="tablist" aria-label="Filter">
          {pills.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => {
                setTab(t.key);
                setScrolled(0);
              }}
              className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition", tab === t.key ? "border-sky-500 bg-sky-500 text-white" : "border-line text-slate-600 hover:border-slate-300 hover:text-slate-900")}
            >
              {t.label}
              <span className={cn("text-[12px] font-normal", tab === t.key ? "text-white/90" : "text-slate-500")}>{count(t.key)}</span>
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="flex items-center gap-3 border-t border-line px-5 py-6 text-sm text-emerald-700">
          <CircleCheck size={20} />
          {items.length === 0 ? empty : "Nothing here."}
        </div>
      ) : (
        <>
          <ul
            ref={list}
            key={tab}
            className={cn("divide-y divide-line border-t border-line [--row:5.25rem] sm:[--row:4.25rem]", shown.length > VISIBLE && "overflow-y-auto overscroll-contain")}
            style={shown.length > VISIBLE ? { maxHeight: `calc(var(--row) * ${VISIBLE} + ${VISIBLE}px)` } : undefined}
            onScroll={(e) => setScrolled(Math.round(e.currentTarget.scrollTop / rowHeight()))}
          >
            {shown.map((i) => {
              const Icon = ICONS[i.icon] ?? AlertTriangle;
              return (
                <li key={i.id}>
                  <Link href={i.href} className="group flex h-[var(--row)] items-center gap-3.5 px-4 transition hover:bg-slate-50 sm:px-5">
                    <span className={cn("h-9 w-[3px] shrink-0 rounded-full", BAR[i.tone])} aria-hidden />
                    <Icon size={20} className={cn("shrink-0", ICON_TONE[i.tone])} />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-1 text-[15px] font-semibold leading-snug text-slate-900">{i.title}</span>
                      <span className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-slate-500 sm:line-clamp-1">
                        {i.detail}
                        {(i.main || i.sub) && (
                          <span className="font-medium text-slate-600 sm:hidden">
                            {" · "}
                            {[i.main, i.sub].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </span>
                    </span>
                    {(i.main || i.sub) && (
                      <span className="hidden shrink-0 text-right sm:block">
                        {i.main && <span className="block text-sm font-medium tabular-nums text-slate-700">{i.main}</span>}
                        {i.sub && <span className="block text-xs tabular-nums text-slate-500">{i.sub}</span>}
                      </span>
                    )}
                    <ChevronRight size={17} className="shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-slate-600" />
                  </Link>
                </li>
              );
            })}
          </ul>
          {more > 0 && (
            <button
              type="button"
              onClick={() => list.current?.scrollBy({ top: rowHeight() * VISIBLE, behavior: "smooth" })}
              className="flex w-full items-center justify-center gap-2 border-t border-line py-3 text-sm text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
            >
              <ChevronDown size={16} /> Scroll for {more} more
            </button>
          )}
        </>
      )}
    </section>
  );
}
