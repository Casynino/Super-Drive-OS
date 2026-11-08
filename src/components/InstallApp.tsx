"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, EllipsisVertical, Menu, Share, SquarePlus, Smartphone, TriangleAlert, X } from "lucide-react";
import Modal from "@/components/Modal";
import { detectDevice, type Device } from "@/lib/device";

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
  const [state, setState] = useState<{ ready: boolean; phone: boolean; installed: boolean; device: Device; canPrompt: boolean }>({ ready: false, phone: false, installed: false, device: { os: "other", browser: "other", inApp: false }, canPrompt: false });
  useEffect(() => {
    const check = () => {
      const standalone = window.matchMedia("(display-mode: standalone)").matches || window.matchMedia("(display-mode: fullscreen)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
      const phone = window.matchMedia("(max-width: 1023px)").matches && window.matchMedia("(pointer: coarse)").matches;
      const device = detectDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
      setState({ ready: true, phone, installed: standalone, device, canPrompt: !!deferred });
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

type Step = { text: React.ReactNode; icon?: typeof Share };

/** The three steps for this phone and browser. Every browser words them a little differently, so each gets its own. The picture on the right is the button to look for. */
function stepsFor(d: Device): Step[] {
  const open: Step = {
    text: (
      <>
        Open <b>Super Drive</b> from your home screen.
      </>
    ),
  };
  if (d.os === "ios") {
    return [
      {
        icon: Share,
        text:
          d.browser === "safari" || d.inApp ? (
            <>
              Tap <b>Share</b> at the bottom of Safari (on newer iPhones it is under the <b>···</b> button).
            </>
          ) : (
            <>
              Tap <b>Share</b> next to the address at the top.
            </>
          ),
      },
      {
        icon: SquarePlus,
        text: (
          <>
            Scroll down and tap <b>Add to Home Screen</b>.
          </>
        ),
      },
      {
        text: (
          <>
            Tap <b>Add</b>, then open <b>Super Drive</b> from your home screen.
          </>
        ),
      },
    ];
  }
  switch (d.browser) {
    case "samsung":
      return [
        { icon: Menu, text: <>Tap the menu at the bottom right.</> },
        {
          text: (
            <>
              Tap <b>Add page to</b>, then <b>Home screen</b> (or <b>Install app</b> if you see it).
            </>
          ),
        },
        open,
      ];
    case "huawei":
      return [
        { icon: Menu, text: <>Open the browser menu (at the bottom, or the three dots at the top right).</> },
        {
          text: (
            <>
              Tap <b>Add to home screen</b> (some phones say <b>Add to desktop</b> or hide it under <b>Add to</b>), then confirm.
            </>
          ),
        },
        open,
      ];
    case "firefox":
      return [
        { icon: EllipsisVertical, text: <>Open the browser menu at the top right.</> },
        {
          text: (
            <>
              Tap <b>Install</b>, then <b>Add</b>.
            </>
          ),
        },
        open,
      ];
    default:
      return [
        { icon: EllipsisVertical, text: <>Open the browser menu (the three dots, top right or bottom).</> },
        {
          text: (
            <>
              Tap <b>Install app</b> or <b>Add to Home screen</b>, then <b>Install</b>.
            </>
          ),
        },
        open,
      ];
  }
}

export function InstallSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { device, canPrompt, install } = useInstall();
  const browserName = device.os === "ios" ? "Safari" : "Chrome";
  // a card with space round it, centred, like a pop-up in an app (not a sheet glued to the bottom edge, where the browser's own toolbar sits)
  return (
    <Modal open={open} onClose={onClose} label="Use it as an app" bare>
      <div className="relative w-[calc(100vw-2rem)] max-w-sm rounded-2xl border border-line bg-white p-5 shadow-2xl">
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

        {device.inApp && (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-oil-400/40 bg-oil-400/10 px-3 py-2.5 text-[13px] leading-snug text-slate-800">
            <TriangleAlert size={16} className="mt-px shrink-0 text-oil-500" />
            <span>
              This page is open inside {device.appName}, which cannot put it on the home screen. Tap the <b>···</b> (or three dots) at the top and choose <b>Open in {browserName}</b> or <b>Open in browser</b>, then do these steps.
            </span>
          </div>
        )}

        {canPrompt && !device.inApp ? (
          <div className="mt-4 flex flex-col gap-2">
            <button type="button" className="btn-primary" onClick={async () => { if (await install()) onClose(); }}>
              <Download size={16} /> Install the app
            </button>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Not now
            </button>
          </div>
        ) : (
          <>
            <ol className="mt-4 space-y-2">
              {stepsFor(device).map((st, i) => (
                <li key={i} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5 text-[13px] leading-snug text-slate-700">
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-oil-400 text-[11px] font-semibold text-[#0a1a33]">{i + 1}</span>
                  <span className="min-w-0 flex-1">{st.text}</span>
                  {st.icon && <st.icon size={16} className="shrink-0 text-slate-500" />}
                </li>
              ))}
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
