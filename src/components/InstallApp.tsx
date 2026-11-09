"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, Download, EllipsisVertical, Menu, Share, SquarePlus, X } from "lucide-react";
import { createPortal } from "react-dom";
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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  // On an iPhone in Safari a small arrow points at the Share button, so nobody hunts for it.
  const hint = device.os === "ios" && device.browser === "safari" && !device.inApp && !canPrompt;

  /* Frosted glass that belongs to the page (Nino 2026-11-09, from the ZELab card: "clean, small, match the backdrop"): it sits low, in the
     empty ground above the browser's toolbar, and leaves the logo and the buttons alone; the dim behind it is barely there; the card is see-through,
     navy like the scene, blurring what is under it instead of covering it with a slab. Only a title and plain lines. Closing is the X, a tap outside
     or Escape. Drawn into <body> so no box or menu can cover it. */
  return createPortal(
    <div
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      className={`fixed inset-0 z-[70] flex items-end justify-center bg-black/15 p-5 ${
        hint ? "pb-[calc(max(0.5rem,env(safe-area-inset-bottom))+5.75rem)]" : "pb-[max(1.75rem,calc(env(safe-area-inset-bottom)+1rem))]"
      }`}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Use it like an app"
        className="w-full max-w-[17.5rem] rounded-2xl border border-white/[0.09] bg-[#0a1a33]/75 px-4 pb-1.5 pt-3.5 shadow-[0_18px_44px_-22px_rgba(0,0,0,0.75)] backdrop-blur-2xl backdrop-saturate-150"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[14px] font-medium tracking-tight text-white">Use it like an app</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-1.5 grid size-7 shrink-0 cursor-pointer place-items-center rounded-full text-white/40 transition-colors hover:bg-white/10 hover:text-white/80">
            <X size={14} />
          </button>
        </div>

        {device.inApp && (
          <p className="mt-1.5 border-b border-white/[0.06] pb-2.5 text-[12px] leading-snug text-white/60">
            Opened inside {device.appName}, which cannot add it to the home screen. Tap <b className="font-medium text-white">···</b> at the top, choose <b className="font-medium text-white">Open in {browserName}</b>, then do these steps.
          </p>
        )}

        {canPrompt && !device.inApp ? (
          <div className="mb-1.5 mt-3 flex flex-col items-stretch">
            <button
              type="button"
              className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl bg-white/10 text-[13px] font-medium text-white ring-1 ring-inset ring-white/15 transition-colors hover:bg-white/15"
              onClick={async () => {
                if (await install()) onClose();
              }}
            >
              <Download size={14} /> Install the app
            </button>
            <button type="button" className="h-8 cursor-pointer text-[12px] text-white/45 transition-colors hover:text-white/75" onClick={onClose}>
              Not now
            </button>
          </div>
        ) : (
          <ol className="mt-1.5 divide-y divide-white/[0.06] [&_b]:font-medium [&_b]:text-white">
            {stepsFor(device).map((st, i) => (
              <li key={i} className="flex items-center gap-3 py-2.5 text-[13px] leading-snug text-white/65">
                <span className="w-2.5 shrink-0 text-center font-mono text-[11px] text-oil-400">{i + 1}</span>
                <span className="min-w-0 flex-1">{st.text}</span>
                {st.icon && <st.icon size={14} className="shrink-0 text-white/30" />}
              </li>
            ))}
          </ol>
        )}
      </div>

      {hint && (
        <div aria-hidden className="pointer-events-none fixed inset-x-0 bottom-[calc(max(0.5rem,env(safe-area-inset-bottom))+2.4rem)] z-[71] flex justify-center">
          <span className="flex animate-bounce flex-col items-center gap-0.5 text-[10px] font-medium text-white/80 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
            Share
            <ArrowDown size={14} className="text-oil-400" />
          </span>
        </div>
      )}
    </div>,
    document.body,
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
