"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { trackPage } from "@/lib/auth/track-page";
import { useEffect, useRef, useState } from "react";
import { Bell, ChevronDown, ChevronLeft, ChevronRight, Menu, Search, X } from "lucide-react";
import SidebarFooter from "@/components/SidebarFooter";
import UserMenu from "@/components/UserMenu";
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

const DIM = { color: "var(--glass-text-dim)" } as const;

export default function AppShell({ businessName, user, visibleHrefs, logoutAction, unread, badges, labels, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false); // the menu on a phone
  const [collapsed, setCollapsed] = useState(false); // the narrow icon rail on a computer or tablet
  const [q, setQ] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setOpen(false);
    setQ("");
  }, [pathname]);

  // the rail stays the way the person left it
  useEffect(() => {
    try {
      if (localStorage.getItem("sdoSidebar") === "rail") setCollapsed(true);
    } catch {
      /* no storage: it simply starts open */
    }
  }, []);
  const setRail = (next: boolean) => {
    setCollapsed(next);
    try {
      localStorage.setItem("sdoSidebar", next ? "rail" : "open");
    } catch {
      /* ignore */
    }
  };

  // Ctrl/Cmd + K goes to the search; [ opens or closes the rail
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (collapsed) setRail(false);
        setTimeout(() => searchRef.current?.focus(), 60);
      } else if (e.key === "[" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setRail(!collapsed);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed]);

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
  const topGroups = groups.filter((g) => !g.label);
  const folding = groups.filter((g) => g.label);

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

  const dot = "absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-brand-red shadow-[0_0_8px_rgba(237,28,36,0.7)] ring-2 ring-white dark:ring-[#0f1c33]";
  const count = (item: NavItem) => (item.badge ? badges[item.badge] : 0);
  const nameOf = (item: NavItem) => labels?.[item.href] ?? item.label;
  const countBadge = (n: number) => <span className="shrink-0 rounded-full bg-brand-red px-1.5 text-[11px] font-bold leading-[18px] text-white shadow-[0_0_10px_rgba(237,28,36,0.45)]">{n > 99 ? "99+" : n}</span>;

  // search: filters the pages the person may open; Enter goes to the first
  const term = q.trim().toLowerCase();
  const results = term ? groups.flatMap((g) => g.items.map((item) => ({ item, group: g.label }))).filter(({ item }) => nameOf(item).toLowerCase().includes(term) || item.label.toLowerCase().includes(term)) : [];

  const row = (item: NavItem, child = false) => {
    const isActive = item.href === active;
    const Icon = item.icon;
    const n = count(item);
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          aria-current={isActive ? "page" : undefined}
          className={cn("relative flex items-center gap-3 rounded-lg", child ? "px-3 py-1.5 text-[13px]" : "px-3 py-2 text-[13px]", isActive ? "glass-active font-medium text-slate-900" : "glass-row text-slate-600 hover:text-slate-900")}
        >
          <Icon size={child ? 16 : 18} className={cn("shrink-0", isActive && "text-oil-500")} />
          <span className="min-w-0 flex-1 truncate">{nameOf(item)}</span>
          {n > 0 && countBadge(n)}
        </Link>
      </li>
    );
  };

  const brand = (compact: boolean) => (
    <Link href="/dashboard" className="flex min-w-0 items-center gap-3" aria-label={`${businessName} home`}>
      <Image src="/brand/app-192.png" alt="" width={44} height={44} priority className={cn("shrink-0 rounded-full ring-2 ring-oil-400/45", "h-10 w-10")} />
      {!compact && (
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-sm font-semibold tracking-tight text-slate-900">{businessName}</span>
          <span className="mt-0.5 block truncate text-xs text-slate-500">Sales &amp; distribution</span>
        </span>
      )}
    </Link>
  );

  /** the full menu: brand, search, MAIN, WORKSPACE (folding groups with branches), night mode and the person */
  const full = (drawer: boolean) => (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pb-3 pr-7 pt-4">
        {brand(false)}
        {drawer && (
          <button type="button" className="glass-row grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-600" onClick={() => setOpen(false)} aria-label="Close menu">
            <X size={17} />
          </button>
        )}
      </div>

      <div className="px-3 pb-1.5">
        <label className="glass-field flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-500 focus-within:text-slate-900">
          <Search size={16} className="shrink-0" />
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results[0]) router.push(results[0].item.href);
              if (e.key === "Escape") setQ("");
            }}
            placeholder="Search pages"
            aria-label="Search pages"
            className="min-w-0 flex-1 bg-transparent text-slate-900 outline-none placeholder:text-slate-500"
          />
          <kbd className="glass-kbd hidden shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 lg:block">⌘K</kbd>
        </label>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" aria-label="Main">
        {term ? (
          results.length > 0 ? (
            <ul className="mt-2 space-y-0.5">{results.map(({ item }) => row(item))}</ul>
          ) : (
            <p className="px-4 py-6 text-center text-sm text-slate-500">No page matches “{q.trim()}”.</p>
          )
        ) : (
          <>
            {topGroups.length > 0 && (
              <>
                <p className="px-4 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.18em]" style={DIM}>
                  Main
                </p>
                <ul className="space-y-0.5">{topGroups.flatMap((g) => g.items).map((i) => row(i))}</ul>
              </>
            )}
            {folding.length > 0 && (
              <p className="px-4 pb-1 pt-4 text-[10.5px] font-semibold uppercase tracking-[0.18em]" style={DIM}>
                Workspace
              </p>
            )}
            <div className="space-y-0.5">
              {folding.map((group) => {
                const Icon = group.icon;
                const isOpen = openGroup === group.label;
                const here = group.label === activeGroup;
                // a red number on a folded group so a waiting item is never hidden inside it
                const waiting = group.items.reduce((sum, i) => sum + count(i), 0);
                return (
                  <div key={group.label}>
                    <button
                      type="button"
                      onClick={() => setOpenGroup(isOpen ? null : group.label)}
                      aria-expanded={isOpen}
                      className={cn("glass-row flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] font-medium hover:text-slate-900", here ? "text-slate-900" : "text-slate-600")}
                    >
                      {Icon && <Icon size={18} className={cn("shrink-0", here ? "text-oil-500" : "text-slate-400")} />}
                      <span className="flex-1">{group.label}</span>
                      {!isOpen && waiting > 0 && countBadge(waiting)}
                      <ChevronDown size={15} className={cn("shrink-0 text-slate-400 transition-transform duration-200", isOpen && "rotate-180")} />
                    </button>
                    <div className={cn("grid transition-[grid-template-rows] duration-200 ease-out", isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
                      <div className="overflow-hidden" inert={!isOpen}>
                        <ul className="glass-tree ml-[1.7rem] mt-1 space-y-0.5 pb-1 pl-3.5">{group.items.map((i) => row(i, true))}</ul>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </nav>

      <SidebarFooter name={user.name} roleName={user.roleName} logoutAction={logoutAction} unread={unread} />
    </div>
  );

  /** the narrow rail: only icons, thin lines between the sets, red dots for what waits, night mode and the person */
  const rail = (
    <div className="flex min-h-0 flex-1 flex-col items-center">
      <div className="pb-2 pr-3 pt-4">{brand(true)}</div>
      <button
        type="button"
        onClick={() => {
          setRail(false);
          setTimeout(() => searchRef.current?.focus(), 80);
        }}
        title="Search pages (Ctrl K)"
        aria-label="Search pages"
        className="glass-row mb-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-600 hover:text-slate-900"
      >
        <Search size={18} />
      </button>
      <nav className="flex min-h-0 w-full flex-1 flex-col items-center overflow-y-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Main">
        {/* every page is its own icon, a plain link: nothing opens, only a small name appears on hover */}
        {groups.map((g, gi) => (
          <div key={g.label || `top-${gi}`} className="flex w-full flex-col items-center">
            <div className="glass-divider my-1.5 w-7" />
            {g.items.map((item) => {
              const isActive = item.href === active;
              const Icon = item.icon;
              const n = count(item);
              return (
                <Link key={item.href} href={item.href} title={nameOf(item)} aria-label={nameOf(item)} aria-current={isActive ? "page" : undefined} className={cn("relative mb-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full", isActive ? "glass-active text-slate-900" : "glass-row text-slate-500 hover:text-slate-900")}>
                  <Icon size={17} className={isActive ? "text-oil-500" : ""} />
                  {n > 0 && <span className={dot} aria-hidden />}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <SidebarFooter name={user.name} roleName={user.roleName} logoutAction={logoutAction} unread={unread} rail />
    </div>
  );

  const dateText = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Dar_es_Salaam" }).format(new Date());
  const dateShort = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Dar_es_Salaam" }).format(new Date()); // phones

  return (
    <div className={cn("min-h-dvh transition-[padding] duration-200 print:pl-0", collapsed ? "lg:pl-[5.9rem]" : "lg:pl-[15.5rem]")}>
      {/* Desktop and tablet: the glass sidebar. The round button on its edge folds it into an icon rail and back. */}
      <aside className={cn("fixed left-3 top-3 z-30 hidden lg:block print:hidden", collapsed ? "w-[4.5rem]" : "bottom-3 w-56")}>
        <div className={cn("glass-panel flex flex-col", collapsed ? "max-h-[calc(100dvh-1.5rem)]" : "h-full")}>{collapsed ? rail : full(false)}</div>
        <div className="group absolute -right-3.5 top-[1.65rem] z-10">
          <button type="button" onClick={() => setRail(!collapsed)} aria-label={collapsed ? "Expand the menu" : "Collapse the menu"} className="grid h-7 w-7 place-items-center rounded-full bg-white text-slate-800 shadow-[0_4px_14px_rgba(0,0,0,0.4)] ring-1 ring-black/10 transition hover:scale-105">
            {collapsed ? <ChevronRight size={15} strokeWidth={2.5} /> : <ChevronLeft size={15} strokeWidth={2.5} />}
          </button>
          <span className="pointer-events-none absolute left-9 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 opacity-0 shadow-lg transition group-hover:opacity-100">
            {collapsed ? "Expand" : "Collapse"} <kbd className="ml-1 rounded bg-slate-100 px-1 text-[10px] text-slate-500">[</kbd>
          </span>
        </div>
      </aside>

      {/* Phone: the same panel slides over the page */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} aria-hidden />
          <aside className="absolute inset-y-3 left-3 w-64 max-w-[85vw]">
            <div className="glass-panel h-full">{full(true)}</div>
          </aside>
        </div>
      )}

      {/* Top bar on a phone only: menu button, date, bell, person. On a computer or tablet there is none (Nino 2026-11-08: "we do not need this"): the bell is in the sidebar. */}
      <div className="pointer-events-none sticky top-0 z-20 px-4 pb-3 pt-3 print:hidden sm:px-6 lg:hidden xl:px-8" style={{ background: "linear-gradient(to bottom, var(--color-surface) 60%, transparent)" }}>
        <header className="pointer-events-auto flex h-14 items-center justify-between gap-3 rounded-2xl border border-line bg-white/90 px-3 shadow-sm backdrop-blur sm:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" className="btn-secondary btn-sm lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
              <Menu size={18} />
            </button>
            <p className="min-w-0 truncate text-sm font-medium text-slate-700" suppressHydrationWarning>
              <span className="hidden sm:inline">{dateText}</span>
              <span className="sm:hidden">{dateShort}</span>
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <Link href="/notifications" className="relative grid h-9 w-9 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900" title="Notifications">
              <Bell size={18} />
              <span className="sr-only">Notifications{unread > 0 ? `, ${unread} unread` : ""}</span>
              {unread > 0 && <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-red px-1 text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
            </Link>
            <div className="lg:hidden">
              <UserMenu name={user.name} roleName={user.roleName} logoutAction={logoutAction} />
            </div>
          </div>
        </header>
      </div>

      <main className="mx-auto w-full max-w-[1920px] px-4 pb-6 pt-3 sm:px-6 lg:pt-6 xl:px-8 print:max-w-none print:p-0">{children}</main>
    </div>
  );
}
