"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { applyTheme } from "@/lib/theme-client";
import { cn } from "@/lib/utils";

/**
 * A small icon-only button for the home banners (next to the bell) that switches between the night and light look and remembers the
 * choice (cookie `sd-theme`, read by the root layout). From `lg` only: a phone has it in its profile menu.
 */
export default function BannerTheme({ className }: { className?: string }) {
  const [dark, setDark] = useState(true);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    applyTheme(next);
  };
  const label = dark ? "Switch to the light look" : "Switch to night mode";
  return (
    <button type="button" onClick={toggle} title={label} aria-label={label} aria-pressed={dark} className={cn("hidden place-items-center text-white/65 transition hover:text-white lg:inline-grid", className)}>
      {dark ? <Moon size={15} /> : <Sun size={15} />}
    </button>
  );
}
