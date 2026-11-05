"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
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

const STORAGE_KEY = "sd-nav-closed";

export default function AppShell({ businessName, user, visibleHrefs, logoutAction, unread, badges, children }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // groups the person has folded away (remembered on this device)
  const [closed, setClosed] = useState<Record<string, boolean>>({});

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    try {
      setClosed(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, boolean>);
    } catch {
      /* private mode etc.: everything simply stays open */
    }
  }, []);

  const visible = new Set(visibleHrefs);
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.ready && visible.has(i.href)) })).filter((g) => g.items.length > 0);

  // The most specific matching item is the active one (so /settings/roles doesn't also light up /settings).
  const allItems = groups.flatMap((g) => g.items);
  const active = allItems
    .filter((i) => pathname === i.href || pathname.startsWith(i.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const activeGroup = groups.find((g) => g.items.some((i) => i.href === active))?.label;

  // Going to a page inside a folded group opens that group again
  useEffect(() => {
    if (activeGroup && closed[activeGroup]) setClosed((c) => ({ ...c, [activeGroup]: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const toggle = (label: string) =>
    setClosed((c) => {
      const next = { ...c, [label]: !c[label] };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });

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
          className={cn("relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition", isActive ? "bg-navy-50 font-semibold text-navy-800" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900")}
        >
          {isActive && <span className="absolute inset-y-1.5 -left-[9px] w-[3px] rounded-r bg-oil-400" />}
          <Icon size={18} className={cn("shrink-0", isActive ? "text-navy-700" : "text-slate-400")} />
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {n > 0 && <span className="shrink-0 rounded-full bg-brand-red px-1.5 text-[11px] font-bold leading-[18px] text-white">{n > 99 ? "99+" : n}</span>}
        </Link>
      </li>
    );
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <Link href="/dashboard" className="block" aria-label={`${businessName} home`}>
          <Image src="/brand/logo-full.png" alt={businessName} width={900} height={456} className="brand-logo h-12 w-auto" priority />
        </Link>
        <button type="button" className="btn-secondary btn-sm lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
          <X size={16} />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main">
        {groups.map((group) => {
          if (!group.label)
            return (
              <ul key="top" className="mb-3 space-y-0.5">
                {group.items.map(link)}
              </ul>
            );
          const Icon = group.icon;
          const isOpen = !closed[group.label];
          const here = group.label === activeGroup;
          return (
            <div key={group.label} className="mb-2">
              <button
                type="button"
                onClick={() => toggle(group.label)}
                aria-expanded={isOpen}
                className="group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 transition hover:text-slate-800"
              >
                {Icon && <Icon size={15} className={cn("shrink-0", here ? "text-oil-500" : "text-slate-400")} />}
                <span className="flex-1">{group.label}</span>
                <ChevronDown size={14} className={cn("shrink-0 text-slate-400 transition-transform", !isOpen && "-rotate-90")} />
              </button>
              {isOpen && <ul className="ml-[1.2rem] mt-0.5 space-y-0.5 border-l border-line pl-2">{group.items.map(link)}</ul>}
            </div>
          );
        })}
      </nav>

    </div>
  );

  return (
    <div className="min-h-dvh lg:pl-64 print:pl-0">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line bg-white lg:block print:hidden">{sidebar}</aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-navy-950/60" onClick={() => setOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-xl">{sidebar}</aside>
        </div>
      )}

      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-white/95 px-4 backdrop-blur print:hidden sm:px-6">
        <button type="button" className="btn-secondary btn-sm lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
          <Menu size={18} />
        </button>
        <p className="hidden text-sm font-medium text-slate-500 lg:block">{businessName}</p>

        <div className="flex items-center gap-2 sm:gap-2.5">
          <ThemeToggle />
          <Link href="/notifications" className="btn-secondary btn-sm relative" title="Notifications">
            <Bell size={15} />
            <span className="sr-only">Notifications{unread > 0 ? `, ${unread} unread` : ""}</span>
            {unread > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-red px-1 text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
          </Link>
          <form action={logoutAction}>
            <button type="submit" className="btn-secondary btn-sm" title="Sign out">
              <LogOut size={15} />
              <span className="hidden sm:inline">Sign out</span>
              <span className="sr-only sm:hidden">Sign out</span>
            </button>
          </form>
          <Link href="/account" title={`${user.name} · ${user.roleName} — my account and password`} className="flex h-9 w-9 items-center justify-center rounded-full bg-navy-700 text-xs font-semibold text-white ring-2 ring-transparent transition hover:ring-oil-400">
            {initials(user.name)}
            <span className="sr-only">My account and password</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1920px] px-4 py-6 sm:px-6 xl:px-8 print:max-w-none print:p-0">{children}</main>
    </div>
  );
}
