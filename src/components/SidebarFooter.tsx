"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bell, KeyRound, LogOut, Moon, Sun, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}

/**
 * The bottom of the glass sidebar: only the signed-in person as initials and the first name (Nino 2026-11-08: no bell or night-mode
 * icons here). A small menu opens from it: full name and position, My profile, Notifications (with the unread count), Change password,
 * the light / night look, Sign out. In the narrow rail only the initials show.
 */
export default function SidebarFooter({ name, roleName, logoutAction, unread = 0, rail }: { name: string; roleName: string; logoutAction: () => Promise<void>; unread?: number; rail?: boolean }) {
  const pathname = usePathname();
  const [dark, setDark] = useState(true);
  const [menu, setMenu] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  useEffect(() => setMenu(false), [pathname]);
  useEffect(() => {
    if (!menu) return;
    const down = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setMenu(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [menu]);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    document.cookie = `sd-theme=${next ? "dark" : "light"}; path=/; max-age=31536000; samesite=lax`;
  };
  const item = "glass-row flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-slate-700 hover:text-slate-900";

  return (
    <div className={cn("px-3 pb-3", rail && "flex flex-col items-center px-0")}>
      <div className="glass-divider mb-2 w-full" />
      <div className="relative w-full" ref={box}>
        <button type="button" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu" className={cn("glass-row flex w-full items-center gap-3 rounded-full text-left", rail ? "justify-center p-1" : "px-2 py-2")} title={name}>
          <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-navy-600 to-navy-800 text-xs font-semibold text-white ring-1 ring-white/25">
            {initials(name)}
            {unread > 0 && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-brand-red ring-2 ring-white dark:ring-[#0f1c33]" aria-hidden />}
          </span>
          {/* only the initials and ONE name (the first); the full name and the position are in the menu that opens from here */}
          {!rail && <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">{name.trim().split(/\s+/)[0]}</span>}
        </button>

        {menu && (
          <div role="menu" className={cn("absolute z-50 w-44 overflow-hidden rounded-xl border border-line bg-white p-1 shadow-[0_12px_30px_-12px_rgba(0,0,0,0.55)]", rail ? "bottom-0 left-full ml-3" : "bottom-full left-0 mb-2")}>
            <div className="px-2.5 pb-1.5 pt-1">
              <p className="break-words text-[13px] font-semibold leading-snug text-slate-900">{name}</p>
              <p className="truncate text-[11px] text-slate-500">{roleName}</p>
            </div>
            <Link href="/account" role="menuitem" className={item}>
              <UserRound size={14} /> My profile
            </Link>
            <Link href="/notifications" role="menuitem" className={item}>
              <Bell size={14} /> Notifications
              {unread > 0 && <span className="ml-auto rounded-full bg-brand-red px-1.5 text-[10px] font-bold leading-4 text-white">{unread > 99 ? "99+" : unread}</span>}
            </Link>
            <Link href="/account#password" role="menuitem" className={item}>
              <KeyRound size={14} /> Change password
            </Link>
            <button type="button" role="menuitem" className={item} onClick={() => { toggleTheme(); setMenu(false); }}>
              {dark ? <Sun size={14} /> : <Moon size={14} />} {dark ? "Light look" : "Night mode"}
            </button>
            <form action={logoutAction}>
              <button type="submit" role="menuitem" className={cn(item, "text-rose-600 hover:text-rose-600 dark:text-rose-400")}>
                <LogOut size={14} /> Sign out
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
