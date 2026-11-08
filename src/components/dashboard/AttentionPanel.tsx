"use client";

import Link from "next/link";
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CalendarCheck, ChevronDown, ChevronRight, ChevronUp, CircleCheck, ClipboardList, Clock, HandCoins, Handshake, Package, PackageCheck, PackageOpen, ReceiptText, Truck, TriangleAlert, Undo2 } from "lucide-react";
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
/** the Director's tabs; other departments pass their own */
export const DIRECTOR_TABS: AttentionTab[] = [
  { key: "decisions", label: "Decisions" },
  { key: "money", label: "Money" },
  { key: "stock", label: "Stock" },
];

/** Until the rows are measured (first paint) only the first three show, so nothing jumps. */
const HIDE_AFTER_3 = "[&_[data-row]:nth-child(n+4)]:hidden";
const VISIBLE = 3;

/**
 * Shows the first three rows (elements marked `data-row`); the rest are a scroll away. The height is measured from the real rows, so exactly three
 * fit on every screen size even when a title wraps. The bar underneath says how many more there are and brings them up when pressed; at the end it
 * says "Back to the top". A soft edge says the list goes on. (Same behaviour as the Vegas hotel system's `ShowRows`.)
 */
function ShowRows({ total, children }: { total: number; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [max, setMax] = useState<number | null>(null);
  const [below, setBelow] = useState(total - VISIBLE);
  const extra = total - VISIBLE;

  const parts = useCallback(() => {
    const el = box.current!;
    const rect = el.getBoundingClientRect();
    const rows = [...el.querySelectorAll<HTMLElement>("[data-row]")];
    const visibleBottom = rect.top + el.clientHeight;
    return { el, rect, rows, hidden: rows.filter((r) => r.getBoundingClientRect().bottom > visibleBottom + 1) };
  }, []);

  useLayoutEffect(() => {
    if (!box.current || extra <= 0) return;
    const measure = () => {
      const { el, rect, rows } = parts();
      const last = rows[VISIBLE - 1];
      if (!last) return;
      setMax(Math.ceil(last.getBoundingClientRect().bottom - (rect.top - el.scrollTop)));
      requestAnimationFrame(() => box.current && setBelow(parts().hidden.length));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [extra, parts]);

  if (extra <= 0) return <div>{children}</div>;
  const step = () => {
    const { el, rect, hidden } = parts();
    if (!hidden.length) {
      el.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    el.scrollTo({ top: el.scrollTop + hidden[0].getBoundingClientRect().top - rect.top, behavior: "smooth" });
  };
  return (
    <div>
      <div className="relative">
        <div ref={box} className={cn("relative overflow-auto overscroll-contain [scrollbar-width:thin]", max === null && HIDE_AFTER_3)} style={max === null ? undefined : { maxHeight: max }} onScroll={() => setBelow(parts().hidden.length)}>
          {children}
        </div>
        <div aria-hidden className={cn("pointer-events-none absolute inset-x-0 bottom-0 h-3 bg-gradient-to-t from-black/25 to-transparent transition-opacity dark:from-black/50", !below && "opacity-0")} />
      </div>
      <button type="button" onClick={step} className="flex w-full items-center justify-center gap-1 border-t border-line py-1.5 text-[11px] text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800">
        {below ? (
          <>
            <ChevronDown className="size-3" />
            Scroll for {below} more
          </>
        ) : (
          <>
            <ChevronUp className="size-3" />
            Back to the top
          </>
        )}
      </button>
    </div>
  );
}

/**
 * "Needs your attention", the same on every home page and screen size. It is a copy of the Vegas hotel system's panel (Nino 2026-11-08, from that
 * project's own code, not from screenshots, which are taken at different zoom levels): area chips on top, then one slim row per item (coloured bar,
 * icon, what and why, a tap through), three rows in view and the rest a scroll away. Chips for groups with nothing in them are not drawn.
 * Sizes are Vegas's: chips 12 px (py-1), rows py-3 with a 14 px title and a 12 px detail, an 18 px icon, a 3 px bar 32 px high.
 */
export default function AttentionPanel({ items, tabs = DIRECTOR_TABS, empty = "Nothing needs your attention right now.", className }: { items: AttentionItem[]; tabs?: AttentionTab[]; empty?: string; /** spacing around the whole block (heading + card) */ className?: string }) {
  const [tab, setTab] = useState("all");
  const shown = tab === "all" ? items : items.filter((i) => i.group === tab);
  const count = (k: string) => (k === "all" ? items.length : items.filter((i) => i.group === k).length);
  const chips: AttentionTab[] = [{ key: "all", label: "All" }, ...tabs].filter((t) => t.key === "all" || t.key === tab || count(t.key) > 0);

  return (
    <section id="attention" aria-label="Needs your attention" className={cn("scroll-mt-20", className)}>
      <h2 className="mb-2.5 flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
        Needs your attention
        <span className="rounded-full bg-[#fdebc4] px-2 py-0.5 text-[11px] font-bold tracking-normal text-[#3a2a00]">{items.length}</span>
      </h2>
      <div className="mb-2 flex flex-wrap gap-1.5" role="tablist" aria-label="Filter">
        {chips.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors", tab === t.key ? "bg-sky-500 text-white" : "bg-slate-100 text-slate-600 hover:text-slate-900")}
          >
            {t.label} <span className="opacity-60">{count(t.key)}</span>
          </button>
        ))}
      </div>
      <div className="card overflow-hidden rounded-xl">
        {shown.length === 0 ? (
          <div className="flex items-center gap-2.5 px-3.5 py-3 text-[13px] text-emerald-700">
            <CircleCheck size={16} />
            {items.length === 0 ? empty : "Nothing here."}
          </div>
        ) : (
          <ShowRows key={tab} total={shown.length}>
            <ul className="divide-y divide-line">
              {shown.map((i) => {
                const Icon = ICONS[i.icon] ?? AlertTriangle;
                return (
                  <li key={i.id} data-row>
                    <Link href={i.href} className="group flex items-center gap-2.5 px-3.5 py-2.5 transition-colors hover:bg-slate-50">
                      <span aria-hidden className={cn("h-7 w-[3px] shrink-0 rounded-full", BAR[i.tone])} />
                      <Icon className={cn("size-4 shrink-0", ICON_TONE[i.tone])} />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-[13px] font-semibold leading-tight text-slate-900 sm:line-clamp-1">{i.title}</span>
                        <span className="block truncate text-[11px] leading-tight text-slate-500">
                          {i.main && <span className="font-medium text-slate-700 sm:hidden">{i.main} · </span>}
                          {i.detail}
                        </span>
                      </span>
                      {(i.main || i.sub) && (
                        <span className="hidden shrink-0 text-right leading-tight sm:block">
                          {i.main && <span className="block text-[13px] font-bold tabular-nums text-slate-900">{i.main}</span>}
                          {i.sub && <span className="block text-[11px] tabular-nums text-slate-500">{i.sub}</span>}
                        </span>
                      )}
                      <ChevronRight className="size-3.5 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </ShowRows>
        )}
      </div>
    </section>
  );
}
