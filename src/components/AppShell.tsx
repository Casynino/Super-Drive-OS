"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { trackPage } from "@/lib/auth/track-page";
import { useEffect, useState } from "react";
import { Bell, ChevronDown, LogOut, Menu, X } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";
import { NAV, type NavItem } from "./nav";

type Props = {
  businessName: string;
  user: { name: string; roleName: string };
  /** hrefs the signed-in user may see (computed on the server from permissions) */
  visibleHrefs: string[];
  logoutAction: () => Promise<void>;
  unread: number;
  /** numbers shown beside menu items that need someone to act */
  badges: { approvals: number; incoming: number };
  /** a different menu name for this person (for example the shop person's "Close & deposit" where the Director has "Closing") */
  labels?: Record<string, string>;
  children: React.ReactNode;
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export default function AppShell({ businessName, user, visibleHrefs, logoutAction, unread, badges, labels, children }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

  // Back works like in an app: remember the page you came from (see BackLink)
  useEffect(() => {
    try {
      const cur = sessionStorage.getItem("sdoCur");
      if (cur !== pathname) {
        if (cur) sessionStorage.setItem("sdoPrev", cur);
        sessionStorage.setItem("sdoCur", pathname);
      }
    } catch {
      /* private mode: Back falls back to the parent page */
    }
  }, [pathname]);

  // The Admin can follow what everyone opens: one activity row per page (after the page has its title)
  useEffect(() => {
    const t = setTimeout(() => void trackPage(pathname, document.title.replace(/\s*·\s*Super Drive Oil$/, "")), 700);
    return () => clearTimeout(t);
  }, [pathname]);

  const visible = new Set(visibleHrefs);
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.ready && visible.has(i.href)) })).filter((g) => g.items.length > 0);

  // The most specific matching item is the active one (so /settings/roles doesn't also light up /settings).
  const allItems = groups.flatMap((g) => g.items);
  const active = allItems
    .map((i) => ({ href: i.href, len: Math.max(0, ...[i.href, ...(i.also ?? [])].filter((h) => pathname === h || pathname.startsWith(h + "/")).map((h) => h.length)) }))
    .filter((i) => i.len > 0)
    .sort((a, b) => b.len - a.len)[0]?.href;
  const activeGroup = groups.find((g) => g.items.some((i) => i.href === active))?.label;

  // Accordion: one group open at a time. It starts on the group of the page you are on, and follows you when you go to another page.
  const [openGroup, setOpenGroup] = useState<string | null>(activeGroup ?? null);
  useEffect(() => {
    if (activeGroup) setOpenGroup(activeGroup);
  }, [activeGroup]);

  const count = (item: NavItem) => (item.badge ? badges[item.badge] : 0);

  const link = (item: NavItem) => {
    const isActive = item.href === active;
    const Icon = item.icon;
    const n = count(item);
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          aria-current={isActive ? "page" : undefined}
          className={cn("relative flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] transition", isActive ? "bg-oil-400/[0.14] font-medium text-slate-900 ring-1 ring-inset ring-oil-400/30" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900")}
        >
          <Icon size={17} className={cn("shrink-0", isActive ? "text-oil-500" : "text-slate-400")} />
          <span className="min-w-0 flex-1 truncate">{labels?.[item.href] ?? item.label}</span>
          {n > 0 && <span className="shrink-0 rounded-full bg-brand-red px-1.5 text-[11px] font-bold leading-[18px] text-white">{n > 99 ? "99+" : n}</span>}
        </Link>
      </li>
    );
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-4">
        <Link href="/dashboard" className="flex min-w-0 items-center gap-3" aria-label={`${businessName} home`}>
          <Image src="/brand/app-192.png" alt="" width={44} height={44} priority className="h-11 w-11 shrink-0 rounded-xl ring-1 ring-oil-400/40" />
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[15px] font-semibold tracking-tight text-slate-900">{businessName}</span>
            <span className="mt-0.5 block truncate text-xs text-slate-500">Sales &amp; distribution</span>
          </span>
        </Link>
        <button type="button" className="btn-secondary btn-sm lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
          <X size={16} />
        </button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Main">
        {groups.map((group) => {
          if (!group.label)
            return (
              <ul key="top" className="mb-2 space-y-0.5">
                {group.items.map(link)}
              </ul>
            );
          const Icon = group.icon;
          const isOpen = openGroup === group.label;
          const here = group.label === activeGroup;
          // a red number on a folded group so a waiting approval is never hidden inside it
          const waiting = group.items.reduce((sum, i) => sum + count(i), 0);
          return (
            <div key={group.label}>
              <button
                type="button"
                onClick={() => setOpenGroup(isOpen ? null : group.label)}
                aria-expanded={isOpen}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.14em] transition",
                  isOpen ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:bg-slate-100/70 hover:text-slate-800",
                )}
              >
                {Icon && <Icon size={16} className={cn("shrink-0", here ? "text-oil-500" : "text-slate-400")} />}
                <span className="flex-1">{group.label}</span>
                {!isOpen && waiting > 0 && <span className="rounded-full bg-brand-red px-1.5 text-[11px] font-bold normal-case leading-[18px] tracking-normal text-white">{waiting > 99 ? "99+" : waiting}</span>}
                <ChevronDown size={14} className={cn("shrink-0 text-slate-400 transition-transform duration-200", !isOpen && "-rotate-90")} />
              </button>
              <div className={cn("grid transition-[grid-template-rows] duration-200 ease-out", isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
                <div className="overflow-hidden" inert={!isOpen}>
                  <ul className="ml-[1.15rem] mt-1 space-y-0.5 border-l border-line pb-1 pl-3">{group.items.map(link)}</ul>
                </div>
              </div>
            </div>
          );
        })}
      </nav>
    </div>
  );

  const dateText = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Dar_es_Salaam" }).format(new Date());

  return (
    <div className="min-h-dvh lg:pl-[17.5rem] print:pl-0">
      {/* Desktop sidebar: a floating panel */}
      <aside className="fixed bottom-3 left-3 top-3 z-30 hidden w-64 overflow-hidden rounded-2xl border border-line bg-white shadow-[0_10px_40px_-16px_rgba(0,0,0,0.45)] lg:block print:hidden">{sidebar}</aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-navy-950/60" onClick={() => setOpen(false)} aria-hidden />
          <aside className="absolute inset-y-3 left-3 w-72 max-w-[85vw] overflow-hidden rounded-2xl border border-line bg-white shadow-xl">{sidebar}</aside>
        </div>
      )}

      {/* Top bar: a floating card with the date on the left and the person on the right */}
      <div className="pointer-events-none sticky top-0 z-20 px-4 pb-3 pt-3 print:hidden sm:px-6 xl:px-8" style={{ background: "linear-gradient(to bottom, var(--color-surface) 60%, transparent)" }}>
        <header className="pointer-events-auto flex h-16 items-center justify-between gap-3 rounded-2xl border border-line bg-white/90 px-3 shadow-sm backdrop-blur sm:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" className="btn-secondary btn-sm lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
              <Menu size={18} />
            </button>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold text-slate-900" suppressHydrationWarning>
                {dateText}
              </p>
              <p className="mt-0.5 truncate text-xs text-slate-500">{businessName}</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
            <ThemeToggle />
            <Link href="/notifications" className="btn-secondary btn-sm relative" title="Notifications">
              <Bell size={15} />
              <span className="sr-only">Notifications{unread > 0 ? `, ${unread} unread` : ""}</span>
              {unread > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-red px-1 text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
            </Link>
            <Link href="/account" title={`${user.name} · ${user.roleName} — my account and password`} className="flex items-center gap-2.5 rounded-xl border border-line py-1 pl-1 pr-1 transition hover:border-oil-400/60 md:pr-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-navy-700 text-xs font-semibold text-white ring-2 ring-oil-400/70">{initials(user.name)}</span>
              <span className="hidden min-w-0 text-left leading-tight md:block">
                <span className="block max-w-[11rem] truncate text-sm font-semibold text-slate-900">{user.name}</span>
                <span className="mt-0.5 block max-w-[11rem] truncate text-xs text-yellow-700 dark:text-oil-400">{user.roleName}</span>
              </span>
              <span className="sr-only">My account and password</span>
            </Link>
            <form action={logoutAction}>
              <button type="submit" className="btn-secondary btn-sm" title="Sign out">
                <LogOut size={15} />
                <span className="sr-only">Sign out</span>
              </button>
            </form>
          </div>
        </header>
      </div>

      <main className="mx-auto w-full max-w-[1920px] px-4 pb-6 pt-3 sm:px-6 xl:px-8 print:max-w-none print:p-0">{children}</main>
    </div>
  );
}
