"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { applyTheme } from "@/lib/theme-client";

/** Switches between the dark and light look and remembers the choice (cookie, so the server renders the right one next time). */
export default function ThemeToggle() {
  const [dark, setDark] = useState(true);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    applyTheme(next);
  };
  return (
    <button type="button" onClick={toggle} className="btn-secondary btn-sm" title={dark ? "Switch to the light look" : "Switch to the dark look"} aria-label={dark ? "Switch to the light look" : "Switch to the dark look"}>
      {dark ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}
