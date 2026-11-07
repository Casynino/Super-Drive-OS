"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronsUpDown, KeyRound, LogOut, Moon, Sun, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}

/**
 * The bottom of the glass sidebar, like the reference: a Night mode switch, then the signed-in person (avatar with a green dot, name and
 * position) who opens a small menu: My profile, Change password, Sign out. In the narrow rail only the icon and the avatar show.
 */
export default function SidebarFooter({ name, roleName, logoutAction, rail }: { name: string; roleName: string; logoutAction: () => Promise<void>; rail?: boolean }) {
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
  const item = "glass-row flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-slate-700 hover:text-slate-900";

  return (
    <div className={cn("px-3 pb-3", rail && "flex flex-col items-center px-0")}>
      <div className="glass-divider mb-2 w-full" />
      {rail ? (
        <button type="button" onClick={toggleTheme} title={dark ? "Switch to the light look" : "Switch to night mode"} className="glass-row mb-1 grid h-11 w-11 place-items-center rounded-full text-slate-600 hover:text-slate-900" aria-label="Night mode">
          {dark ? <Moon size={18} /> : <Sun size={18} />}
        </button>
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-full px-3.5 py-2">
          <span className="flex items-center gap-3 text-[13.5px] font-medium text-slate-600">
            {dark ? <Moon size={18} className="text-slate-500" /> : <Sun size={18} className="text-slate-500" />}
            Night mode
          </span>
          <button type="button" role="switch" aria-checked={dark} aria-label="Night mode" onClick={toggleTheme} className="glass-switch relative h-6 w-11 shrink-0 rounded-full transition">
            <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", dark ? "left-[1.4rem]" : "left-0.5")} />
          </button>
        </div>
      )}

      <div className="relative w-full" ref={box}>
        <button type="button" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu" className={cn("glass-row flex w-full items-center gap-3 rounded-full text-left", rail ? "justify-center p-1" : "px-2 py-2")} title={rail ? name : undefined}>
          <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-navy-600 to-navy-800 text-xs font-semibold text-white ring-1 ring-white/25">
            {initials(name)}
            <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-[#0f1c33]" aria-hidden />
          </span>
          {!rail && (
            <>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-sm font-semibold text-slate-900">{name}</span>
                <span className="mt-0.5 block truncate text-xs text-slate-500">{roleName}</span>
              </span>
              <ChevronsUpDown size={15} className="shrink-0 text-slate-400" aria-hidden />
            </>
          )}
        </button>

        {menu && (
          <div role="menu" className={cn("absolute z-50 w-56 overflow-hidden rounded-2xl border border-line bg-white p-1.5 shadow-[0_16px_40px_-14px_rgba(0,0,0,0.55)]", rail ? "bottom-0 left-full ml-3" : "bottom-full left-0 mb-2")}>
            <div className="px-3 py-2">
              <p className="truncate text-sm font-semibold text-slate-900">{name}</p>
              <p className="truncate text-xs text-slate-500">{roleName}</p>
            </div>
            <Link href="/account" role="menuitem" className={item}>
              <UserRound size={16} /> My profile
            </Link>
            <Link href="/account#password" role="menuitem" className={item}>
              <KeyRound size={16} /> Change password
            </Link>
            <form action={logoutAction}>
              <button type="submit" role="menuitem" className={cn(item, "text-rose-600 hover:text-rose-600 dark:text-rose-400")}>
                <LogOut size={16} /> Sign out
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
