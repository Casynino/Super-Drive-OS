"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { applyTheme } from "@/lib/theme-client";
import { InstallSheet, useInstall } from "@/components/InstallApp";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

/**
 * The person in the top bar: one small round button with their initials. Pressing it opens a small panel with their name, role,
 * My profile, Change password, the light / dark look and Sign out, so the bar itself stays clean.
 */
export default function UserMenu({ name, roleName, logoutAction }: { name: string; roleName: string; logoutAction: () => Promise<void> }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(true);
  const [sheet, setSheet] = useState(false);
  const inst = useInstall();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    setDark(document.documentElement.classList.contains("dark"));
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    applyTheme(next);
  };
  const row = "block w-full px-4 py-2.5 text-left text-sm text-slate-700 transition hover:bg-slate-100 hover:text-slate-900";

  return (
    <div className="relative" ref={box}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" title={name} className="grid h-9 w-9 place-items-center rounded-full border border-line bg-slate-100 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-200">
        {initials(name)}
        <span className="sr-only">My account: {name}</span>
      </button>

      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-line bg-white shadow-[0_16px_40px_-14px_rgba(0,0,0,0.5)]">
          <div className="px-4 py-3">
            <p className="truncate text-sm font-semibold text-slate-900">{name}</p>
            <p className="truncate text-xs text-slate-500">{roleName}</p>
          </div>
          <div className="border-t border-line py-1">
            <Link href="/account" role="menuitem" className={row}>
              My profile
            </Link>
            <Link href="/account#password" role="menuitem" className={row}>
              Change password
            </Link>
            {inst.ready && inst.phone && !inst.installed && (
              <button type="button" role="menuitem" onClick={() => { setOpen(false); setSheet(true); }} className={row}>
                Get the app
              </button>
            )}
            <button type="button" role="menuitem" onClick={toggleTheme} className={row}>
              {dark ? "Light look" : "Dark look"}
            </button>
          </div>
          <form action={logoutAction} className="border-t border-line py-1">
            <button type="submit" role="menuitem" className="block w-full px-4 py-2.5 text-left text-sm font-medium text-rose-600 transition hover:bg-slate-100 dark:text-rose-400">
              Sign out
            </button>
          </form>
        </div>
      )}
      <InstallSheet open={sheet} onClose={() => setSheet(false)} />
    </div>
  );
}
