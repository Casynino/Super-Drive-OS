"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

/**
 * A pop-up: centred on a computer, a bottom sheet on a phone. Escape, a tap outside, or the caller's own close button closes it.
 * The page behind does not scroll while it is open. Children render only while it is open (so a form inside starts fresh each time).
 */
export default function Modal({ open, onClose, label, children, wide }: { open: boolean; onClose: () => void; label: string; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  if (!open || typeof document === "undefined") return null;
  // drawn straight into <body>, so no card or sticky box around the button can put it behind the menu
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={label} className={`flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-white shadow-2xl sm:rounded-2xl ${wide ? "sm:max-w-3xl" : "sm:max-w-xl"}`}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
