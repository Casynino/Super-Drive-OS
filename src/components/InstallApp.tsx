"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, EllipsisVertical, Share, SquarePlus, Smartphone, X } from "lucide-react";
import Modal from "@/components/Modal";

/**
 * Use it as an app (Nino 2026-11-09: "the screen shall be full, just like an app, on any phone"). A website open in a browser tab always keeps the
 * browser's address bar, and no page can hide it; the only way to get a full-screen app is to put the site on the home screen. So: on a phone that
 * has not done that yet, a small sheet shows how (one tap on Android, three steps on an iPhone). It opens by itself once after sign-in,
 * and any time from "Get the app" on the sign-in page and in the person's menu. Nothing shows once the app is installed.
 */

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

// Android / Chrome fires this once, early; it is kept here so any part of the page can use it later
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    listeners.forEach((f) => f());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((f) => f());
  });
}

const SEEN = "sdoInstallSeen";

function read(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function useInstall() {
  const [state, setState] = useState({ ready: false, phone: false, installed: false, ios: false, canPrompt: false });
  useEffect(() => {
    const check = () => {
      const standalone = window.matchMedia("(display-mode: standalone)").matches || window.matchMedia("(display-mode: fullscreen)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
      const phone = window.matchMedia("(max-width: 1023px)").matches && window.matchMedia("(pointer: coarse)").matches;
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      setState({ ready: true, phone, installed: standalone, ios, canPrompt: !!deferred });
    };
    check();
    listeners.add(check);
    return () => void listeners.delete(check);
  }, []);
  const install = useCallback(async () => {
    if (!deferred) return false;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    listeners.forEach((f) => f());
    return outcome === "accepted";
  }, []);
  return { ...state, install };
}

const step = "flex items-start gap-3 rounded-xl bg-slate-50 px-3 py-2.5 text-[13px] leading-snug text-slate-700";
const num = "grid size-5 shrink-0 place-items-center rounded-full bg-oil-400 text-[11px] font-semibold text-[#0a1a33]";

export function InstallSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { ios, canPrompt, install } = useInstall();
  return (
    <Modal open={open} onClose={onClose} label="Use it as an app">
      <div className="relative p-5 max-sm:pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 grid size-8 place-items-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900">
          <X size={16} />
        </button>
        <div className="flex items-center gap-3 pr-8">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#0a1a33] text-oil-400">
            <Smartphone size={20} />
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-900">Use it like an app</h2>
            <p className="text-[13px] text-slate-500">Full screen, no browser bar, its own icon.</p>
          </div>
        </div>

        {canPrompt ? (
          <div className="mt-4 flex flex-col gap-2">
            <button type="button" className="btn-primary" onClick={async () => { if (await install()) onClose(); }}>
              <Download size={16} /> Install the app
            </button>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Not now
            </button>
          </div>
        ) : ios ? (
          <>
            <ol className="mt-4 space-y-2">
              <li className={step}>
                <span className={num}>1</span>
                <span>
                  Tap the <Share size={14} className="mx-0.5 inline -translate-y-px" /> <b>Share</b> button at the bottom of Safari.
                </span>
              </li>
              <li className={step}>
                <span className={num}>2</span>
                <span>
                  Scroll down and tap <SquarePlus size={14} className="mx-0.5 inline -translate-y-px" /> <b>Add to Home Screen</b>.
                </span>
              </li>
              <li className={step}>
                <span className={num}>3</span>
                <span>
                  Tap <b>Add</b>, then open <b>Super Drive</b> from your home screen.
                </span>
              </li>
            </ol>
            <p className="mt-3 text-[12px] text-slate-500">If this page opened inside WhatsApp or another app, open it in Safari first.</p>
            <button type="button" className="btn-secondary mt-4 w-full" onClick={onClose}>
              Got it
            </button>
          </>
        ) : (
          <>
            <ol className="mt-4 space-y-2">
              <li className={step}>
                <span className={num}>1</span>
                <span>
                  Open the browser menu <EllipsisVertical size={14} className="mx-0.5 inline -translate-y-px" /> at the top right.
                </span>
              </li>
              <li className={step}>
                <span className={num}>2</span>
                <span>
                  Tap <b>Install app</b> or <b>Add to Home screen</b>, then <b>Install</b>.
                </span>
              </li>
              <li className={step}>
                <span className={num}>3</span>
                <span>
                  Open <b>Super Drive</b> from your home screen.
                </span>
              </li>
            </ol>
            <button type="button" className="btn-secondary mt-4 w-full" onClick={onClose}>
              Got it
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Opens by itself once, a moment after a phone's browser opens the app (not when it is already installed); "Not now" or closing it is remembered. */
export function InstallPrompt() {
  const { ready, phone, installed } = useInstall();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!ready || !phone || installed || read(SEEN)) return;
    const t = window.setTimeout(() => setOpen(true), 2500);
    return () => window.clearTimeout(t);
  }, [ready, phone, installed]);
  const close = () => {
    setOpen(false);
    try {
      window.localStorage.setItem(SEEN, "1");
    } catch {
      /* private window: it simply asks again next time */
    }
  };
  return <InstallSheet open={open} onClose={close} />;
}

/** A button that opens the sheet. Draws nothing on a computer or once the app is installed. `render` lets the caller style it. */
export function InstallButton({ render }: { render: (open: () => void) => React.ReactNode }) {
  const { ready, phone, installed } = useInstall();
  const [open, setOpen] = useState(false);
  if (!ready || !phone || installed) return null;
  return (
    <>
      {render(() => setOpen(true))}
      <InstallSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
