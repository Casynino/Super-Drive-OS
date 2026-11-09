"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Smartphone, X } from "lucide-react";
import { InstallButton } from "@/components/InstallApp";
import { cn } from "@/lib/utils";

/**
 * On a phone the sign-in form must not cover the scene (Nino 2026-11-09): the page shows the logo, the animated road and ONE small "Log in"
 * button, and pressing it opens the form as a small pop-up of frosted navy glass, the same family as the install card (Nino 2026-11-09: "clean, small, nice"; Escape, the X or a tap outside closes it). From `md` up the card simply stays on the page,
 * exactly as before (`md:contents` makes this wrapper invisible there).
 */
export default function LoginGate({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ls-up inline-flex h-11 items-center gap-2 rounded-full bg-oil-400 px-7 text-[15px] font-semibold text-[#0a1a33] shadow-[0_8px_24px_-8px_rgba(0,0,0,0.6)] transition-colors hover:brightness-105 active:scale-[0.98] md:hidden"
        style={{ "--rd": "0.5s" } as React.CSSProperties}
      >
        Log in
        <ArrowRight size={16} />
      </button>
      {/* a browser tab always keeps its address bar; the installed app is full screen (only phones that have not installed it see this) */}
      <InstallButton
        render={(openSheet) => (
          <button type="button" onClick={openSheet} className="ls-up mt-3 inline-flex items-center gap-1.5 text-[13px] text-white/65 underline-offset-4 transition-colors hover:text-white hover:underline md:hidden" style={{ "--rd": "0.7s" } as React.CSSProperties}>
            <Smartphone size={14} />
            Get the full-screen app
          </button>
        )}
      />

      <div
        className={cn(
          "md:contents",
          open ? "ls-sheet max-md:fixed max-md:inset-0 max-md:z-50 max-md:flex max-md:items-start max-md:justify-center max-md:bg-[#030812]/45 max-md:p-5 max-md:pt-[calc(env(safe-area-inset-top,0px)+10vh)] max-md:backdrop-blur-[2px]" : "max-md:hidden",
        )}
        onClick={(e) => e.target === e.currentTarget && setOpen(false)}
      >
        <div className={cn("relative w-full max-w-[19rem] md:max-w-sm", open && "ls-pop md:animate-none")}>
          {children}
          {open && (
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full text-white/40 transition-colors hover:bg-white/10 hover:text-white/80 md:hidden">
              <X size={14} />
            </button>
          )}
        </div>
      </div>
    </>
  );
}
