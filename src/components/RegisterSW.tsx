"use client";

import { useEffect } from "react";

/** Registers /sw.js (see it for what it does: nothing is stored, it only shows "No internet" when a page cannot load). Production only, so development reloads are never touched. */
export default function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    const go = () => navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    if (document.readyState === "complete") go();
    else window.addEventListener("load", go, { once: true });
  }, []);
  return null;
}
