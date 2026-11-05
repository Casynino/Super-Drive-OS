"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

/** Switches between the dark and light look and remembers the choice (cookie, so the server renders the right one next time). */
export default function ThemeToggle() {
  const [dark, setDark] = useState(true);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    document.cookie = `sd-theme=${next ? "dark" : "light"}; path=/; max-age=31536000; samesite=lax`;
  };
  return (
    <button type="button" onClick={toggle} className="btn-secondary btn-sm" title={dark ? "Switch to the light look" : "Switch to the dark look"} aria-label={dark ? "Switch to the light look" : "Switch to the dark look"}>
      {dark ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}
