import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type QuickIcon = { href: string; label: string; icon: LucideIcon; /** a red number on the icon: how many things wait there */ n?: number; /** the one main action (blue icon, bold name) */ accent?: boolean };

/**
 * The shortcuts at the top of a home page, the same for every role: plain line icons with their name under them. No boxes, tiles, borders
 * or pills around them (Nino 2026-11-08: "clean look on the icons, no funny shapes"); only a small red number sits on an icon when
 * something waits there. `fill` spreads a few icons over the whole width, otherwise they sit in a row that scrolls sideways.
 */
export default function QuickIcons({ items, fill, className, label = "Shortcuts" }: { items: QuickIcon[]; fill?: boolean; className?: string; label?: string }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label={label} className={cn(fill ? "grid gap-1" : "-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]", className)} style={fill ? { gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` } : undefined}>
      {items.map((q) => (
        <Link key={q.href} href={q.href} className={cn("flex shrink-0 flex-col items-center gap-1.5 rounded-xl px-1 py-2 text-[11px] font-medium text-slate-600 transition hover:text-slate-900 sm:text-[13px]", fill ? "min-w-0" : "w-[4.6rem] sm:w-24")}>
          <span className="relative">
            <q.icon size={26} strokeWidth={1.75} className={q.accent ? "text-blue-600" : "text-slate-500"} />
            {q.n ? <span className="absolute -right-2.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand-red px-1 text-[10px] font-bold leading-none text-white">{q.n > 99 ? "99+" : q.n}</span> : null}
          </span>
          <span className={cn("max-w-full truncate", q.accent && "font-semibold text-slate-900")}>{q.label}</span>
        </Link>
      ))}
    </nav>
  );
}
