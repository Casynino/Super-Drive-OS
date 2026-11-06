"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Flashlight, FlashlightOff, Keyboard } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  /** called once per code (the same code is ignored for a couple of seconds so one scan is not counted twice) */
  onScan: (code: string) => void;
  /** show a dimmed "working" state while the result of the last scan is being looked up */
  busy?: boolean;
  /** open the camera straight away (the POS does) */
  autoStart?: boolean;
  /** smaller camera view (POS) */
  compact?: boolean;
  className?: string;
};

// The camera path uses the browser's built-in BarcodeDetector where it exists (Android Chrome, desktop Chrome and Edge),
// and a bundled reader (zxing, loaded only when needed) everywhere else, including iPhones.
const hasTorch = (t: MediaStreamTrack | null) => Boolean((t?.getCapabilities?.() as { torch?: boolean } | undefined)?.torch);

function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.09);
    o.onended = () => void ctx.close();
  } catch {
    /* sound is a nice-to-have */
  }
}

function friendly(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (typeof window !== "undefined" && !window.isSecureContext) return "The camera only works on a secure (https) connection. You can still type the code below.";
  if (name === "NotAllowedError" || name === "SecurityError") return "The camera is blocked. Allow the camera for this site in your browser settings, then try again. You can still type the code below.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera was found on this device. Type the code below, or use a barcode scanner.";
  if (name === "NotReadableError") return "The camera is being used by another app. Close it and try again.";
  return "The camera could not start. You can still type the code below, or use a barcode scanner.";
}

export default function CodeScanner({ onScan, busy, autoStart = false, compact = false, className }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(autoStart);
  const [error, setError] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const [torchOk, setTorchOk] = useState(false);
  const [manual, setManual] = useState("");
  const last = useRef({ code: "", at: 0 });
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const emit = useCallback((raw: string) => {
    const code = raw.trim();
    const now = Date.now();
    if (!code || (code === last.current.code && now - last.current.at < 2500)) return;
    last.current = { code, at: now };
    beep();
    navigator.vibrate?.(60);
    onScanRef.current(code);
  }, []);

  useEffect(() => {
    if (!on) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let zx: { stop: () => void } | null = null;

    const trackOf = () => (videoRef.current?.srcObject as MediaStream | null)?.getVideoTracks()[0] ?? null;
    const checkTorch = () => setTorchOk(hasTorch(trackOf()));

    (async () => {
      try {
        setError(null);
        if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("no camera api"), { name: "NotFoundError" });
        const constraints: MediaStreamConstraints = { video: { facingMode: { ideal: "environment" } }, audio: false };
        if ("BarcodeDetector" in window) {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (cancelled) return void stream.getTracks().forEach((t) => t.stop());
          const v = videoRef.current!;
          v.srcObject = stream;
          await v.play();
          checkTorch();
          const Detector = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
          const detector = new Detector({ formats: ["qr_code", "ean_13", "ean_8", "upc_a", "code_128"] });
          timer = window.setInterval(async () => {
            if (v.readyState < 2) return;
            try {
              const found = await detector.detect(v);
              if (found[0]?.rawValue) emit(found[0].rawValue);
            } catch {
              /* a frame that cannot be read is simply skipped */
            }
          }, 180);
        } else {
          const { BrowserMultiFormatReader } = await import("@zxing/browser");
          const controls = await new BrowserMultiFormatReader().decodeFromConstraints(constraints, videoRef.current!, (result) => {
            if (result) emit(result.getText());
          });
          if (cancelled) return void controls.stop();
          zx = controls;
          checkTorch();
        }
      } catch (e) {
        if (!cancelled) {
          setError(friendly(e));
          setOn(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      zx?.stop();
      setTorch(false);
      setTorchOk(false);
    };
  }, [on, emit]);

  const toggleTorch = async () => {
    const track = (videoRef.current?.srcObject as MediaStream | null)?.getVideoTracks()[0] ?? null;
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch((t) => !t);
    } catch {
      setTorchOk(false);
    }
  };

  return (
    <div className={cn("space-y-3", className)}>
      <style>{`@keyframes sd-scan-line { 0% { top: 8% } 50% { top: 88% } 100% { top: 8% } } @media (prefers-reduced-motion: reduce) { .sd-scan-line { animation: none !important; top: 50% } }`}</style>
      {on ? (
        <div className={cn("relative overflow-hidden rounded-2xl bg-black", compact ? "aspect-[16/10]" : "aspect-[4/3] max-h-[60vh] w-full")}>
          <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
          {/* the scanning frame */}
          <div className={cn("pointer-events-none absolute inset-[14%] rounded-2xl transition", busy ? "opacity-40" : "opacity-100")}>
            {(["left-0 top-0 border-l-4 border-t-4 rounded-tl-2xl", "right-0 top-0 border-r-4 border-t-4 rounded-tr-2xl", "bottom-0 left-0 border-b-4 border-l-4 rounded-bl-2xl", "bottom-0 right-0 border-b-4 border-r-4 rounded-br-2xl"] as const).map((c) => (
              <span key={c} className={cn("absolute h-9 w-9 border-oil-400", c)} />
            ))}
            <span className="sd-scan-line absolute inset-x-3 h-0.5 rounded bg-oil-400/90 shadow-[0_0_12px_2px_rgba(253,196,0,0.7)]" style={{ animation: "sd-scan-line 2.4s ease-in-out infinite" }} />
          </div>
          <div className="absolute right-2 top-2 flex gap-2">
            {torchOk && (
              <button type="button" onClick={toggleTorch} className="flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur" aria-label={torch ? "Turn the flashlight off" : "Turn the flashlight on"} aria-pressed={torch}>
                {torch ? <FlashlightOff size={18} /> : <Flashlight size={18} />}
              </button>
            )}
            <button type="button" onClick={() => setOn(false)} className="flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur" aria-label="Close the camera">
              <CameraOff size={18} />
            </button>
          </div>
          <p className="absolute inset-x-0 bottom-2 text-center text-xs font-medium text-white/90 drop-shadow">Hold the QR code or barcode inside the frame</p>
        </div>
      ) : (
        <button type="button" onClick={() => setOn(true)} className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-slate-600 transition hover:border-navy-400 hover:text-navy-700">
          <Camera size={34} />
          <span className="text-base font-semibold">Scan with the camera</span>
          <span className="text-xs text-slate-500">Tap, allow the camera, then point it at the QR code</span>
        </button>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-brand-red-soft px-3 py-2 text-sm text-brand-red-dark">
          {error}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const v = manual;
          setManual("");
          emit(v);
          last.current = { code: "", at: 0 }; // typing the same code again on purpose is allowed
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <Keyboard size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={manual} onChange={(e) => setManual(e.target.value)} className="input h-11 pl-9" placeholder="Type or scan a code, e.g. SDO-ITEM-000123" aria-label="Item code" autoComplete="off" autoCapitalize="characters" spellCheck={false} />
        </div>
        <button type="submit" className="btn-primary h-11" disabled={!manual.trim()}>
          Look up
        </button>
      </form>
      {!compact && <p className="text-xs text-slate-500">A USB or Bluetooth barcode scanner works too: click the box above and scan. It types the code and presses Enter by itself.</p>}
    </div>
  );
}
