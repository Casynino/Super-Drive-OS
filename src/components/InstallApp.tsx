"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, EllipsisVertical, Menu, Share, SquarePlus, TriangleAlert, X } from "lucide-react";
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
              Tap <b>Share</b> (bottom bar, or <b>···</b>).
            </>
          ) : (
            <>
              Tap <b>Share</b> in the address bar or menu.
            </>
          ),
      },
      {
        icon: SquarePlus,
        text: (
          <>
            Tap <b>Add to Home Screen</b>.
          </>
        ),
      },
      {
        text: (
          <>
            Tap <b>Add</b>, then open <b>Super Drive</b>.
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
      <div className="relative w-[calc(100vw-2.5rem)] max-w-[19.5rem] rounded-2xl border border-line bg-white p-4 shadow-2xl">
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-2.5 top-2.5 grid size-7 place-items-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900">
          <X size={15} />
        </button>
        <div className="pr-7">
          <h2 className="text-[15px] font-semibold leading-tight text-slate-900">Use it like an app</h2>
          <p className="mt-0.5 text-xs text-slate-500">Full screen, no browser bar, its own icon.</p>
        </div>

        {device.inApp && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-oil-400/40 bg-oil-400/10 px-2.5 py-2 text-xs leading-snug text-slate-800">
            <TriangleAlert size={14} className="mt-px shrink-0 text-oil-500" />
            <span>
              Opened inside {device.appName}, which cannot add it to the home screen. Tap <b>···</b> at the top, choose <b>Open in {browserName}</b>, then do these steps.
            </span>
          </div>
        )}

        {canPrompt && !device.inApp ? (
          <div className="mt-3.5 flex flex-col gap-1.5">
            <button type="button" className="btn-primary w-full py-2 text-[13px]" onClick={async () => { if (await install()) onClose(); }}>
              <Download size={14} /> Install the app
            </button>
            <button type="button" className="btn-secondary w-full py-1.5 text-[12.5px]" onClick={onClose}>
              Not now
            </button>
          </div>
        ) : (
          <>
            <ol className="mt-3 space-y-1.5">
              {stepsFor(device).map((st, i) => (
                <li key={i} className="flex items-center gap-2.5 rounded-lg bg-slate-50 px-2.5 py-2 text-[12.5px] leading-snug text-slate-700">
                  <span className="grid size-4 shrink-0 place-items-center rounded-full bg-oil-400 text-[10px] font-semibold text-[#0a1a33]">{i + 1}</span>
                  <span className="min-w-0 flex-1">{st.text}</span>
                  {st.icon && <st.icon size={14} className="shrink-0 text-slate-500" />}
                </li>
              ))}
            </ol>
            <button type="button" className="btn-secondary mt-3 w-full py-1.5 text-[12.5px]" onClick={onClose}>
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
