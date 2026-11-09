"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

/** The version this page was built from (see next.config.ts). */
const MINE = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";

/**
 * "New update" (Nino 2026-11-09, from Target Express's "New update is up" pill: smaller, cooler, and at the TOP). While the app is open it asks the
 * server every minute, and whenever the person comes back to the tab, which version is newest. When it is not the one this page was built from, a
 * small glass pill drops in at the top; pressing it reloads the page into the new version. Nothing reloads by itself, so a sale in progress is never
 * lost. It stays silent in development and on builds that have no version id.
 */
export default function UpdateNotice() {
  const [fresh, setFresh] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || MINE === "dev") return;
    let live = true;
    const check = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        if (!r.ok) return;
        const { id } = (await r.json()) as { id?: string };
        if (live && id && id !== "dev" && id !== MINE) setFresh(true);
      } catch {
        /* offline or the server is restarting: try again at the next check */
      }
    };
    const timer = window.setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    const first = window.setTimeout(check, 4_000);
    return () => {
      live = false;
      window.clearInterval(timer);
      window.clearTimeout(first);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  if (!fresh) return null;
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      aria-label="New update available. Refresh to get it."
      className="update-in fixed inset-x-0 top-[calc(env(safe-area-inset-top,0px)+0.5rem)] z-[65] mx-auto flex h-8 w-fit items-center gap-2 rounded-full bg-[#0a1a33]/90 pl-3 pr-1.5 text-[12px] font-medium text-white shadow-[0_8px_24px_-8px_rgba(0,0,0,0.7)] ring-1 ring-white/15 backdrop-blur transition-colors hover:bg-[#0e2547]/95 print:hidden"
    >
      <span className="size-1.5 rounded-full bg-[#fdc400]" aria-hidden />
      New update
      <span className="grid size-5 place-items-center rounded-full bg-[#fdc400] text-[#0a1a33]">
        <RefreshCw size={12} strokeWidth={2.4} aria-hidden />
      </span>
    </button>
  );
}
