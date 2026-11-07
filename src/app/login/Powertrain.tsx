"use client";

import { useEffect, useRef, type ReactNode } from "react";

// A V-twin engine cutaway and a rev gauge, animated together: the crank turns, the pistons and rods follow the real
// crank geometry, the spark flashes at the top of every second stroke, and the needle follows the same engine speed.
// Decorative only. Moves attributes directly (no React state), and stays still when the person prefers reduced motion.

const f = (n: number) => n.toFixed(1);
const pt = (cx: number, cy: number, r: number, g: number) => {
  const a = (g * Math.PI) / 180;
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)] as const;
};

const SPAN = 33.75; // gauge degrees per 1000 r/min
const CX = 150; // crank centre
const CY = 190;
const R = 26; // crank throw
const L = 82; // connecting rod
const PHI = [-45, 45]; // cylinder angles (V of 90 degrees)

/** Piston position for a crank angle. `frac` is 0 at the bottom of the stroke and 1 at the top. */
function geo(theta: number, phiDeg: number) {
  const gx = R * Math.sin(theta);
  const gy = -R * Math.cos(theta);
  const p = (phiDeg * Math.PI) / 180;
  const c = Math.cos(p);
  const s = Math.sin(p);
  const lx = gx * c + gy * s;
  const ly = -gx * s + gy * c;
  const py = ly - Math.sqrt(L * L - lx * lx);
  return { lx, ly, py, frac: (-py - (L - R)) / (2 * R) };
}

const rpmAt = (t: number) => Math.min(7.7, Math.max(0.8, 4.1 + 2.7 * Math.sin(t * 0.8) + 0.8 * Math.sin(t * 2.1 + 1)));

// children = something drawn BEHIND the gauge and engine (the sign-in logo)
export default function Powertrain({ children }: { children?: ReactNode }) {
  const needle = useRef<SVGGElement>(null);
  const readout = useRef<SVGTextElement>(null);
  const crank = useRef<SVGGElement>(null);
  const pistons = useRef<(SVGGElement | null)[]>([]);
  const rods = useRef<(SVGLineElement | null)[]>([]);
  const flashes = useRef<(SVGCircleElement | null)[]>([]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let last = performance.now();
    let t = 0;
    let theta = 0;
    let shown = 0;

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      const rpm = rpmAt(t);
      theta += (0.4 + rpm * 0.5) * Math.PI * 2 * dt;

      needle.current?.setAttribute("transform", `rotate(${f(-135 + rpm * SPAN)} 150 150)`);
      if (now - shown > 110) {
        shown = now;
        if (readout.current) readout.current.textContent = rpm.toFixed(1);
      }
      crank.current?.setAttribute("transform", `rotate(${f((theta * 180) / Math.PI)} ${CX} ${CY})`);
      PHI.forEach((phi, i) => {
        const g = geo(theta, phi);
        pistons.current[i]?.setAttribute("transform", `translate(0 ${f(g.py)})`);
        const rod = rods.current[i];
        if (rod) {
          rod.setAttribute("y1", f(CY + g.py));
          rod.setAttribute("x2", f(CX + g.lx));
          rod.setAttribute("y2", f(CY + g.ly));
        }
        // the spark fires on every second trip to the top (four-stroke)
        const strokes = Math.floor((theta + (phi < 0 ? Math.PI / 4 : -Math.PI / 4)) / (Math.PI * 2));
        const fire = strokes % 2 === 0 ? Math.max(0, (g.frac - 0.9) / 0.1) : 0;
        flashes.current[i]?.setAttribute("opacity", f(fire));
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ----- gauge geometry -----
  const ticks = Array.from({ length: 41 }, (_, i) => {
    const v = i / 5;
    const g = -135 + v * SPAN;
    const major = i % 5 === 0;
    const [x1, y1] = pt(150, 150, major ? 116 : 123, g);
    const [x2, y2] = pt(150, 150, 134, g);
    return { x1, y1, x2, y2, major, red: v >= 6.5 };
  });
  const labels = Array.from({ length: 9 }, (_, v) => {
    const [x, y] = pt(150, 150, 96, -135 + v * SPAN);
    return { x, y, v };
  });
  const [ax, ay] = pt(150, 150, 141, -135 + 6.5 * SPAN);
  const [bx, by] = pt(150, 150, 141, 135);

  const BLUE = "#7fb2ff";

  return (
    <div className="ls-power">
      {children}
      <svg className="ls-gauge-svg" viewBox="0 0 300 300" role="presentation" focusable="false">
        <defs>
          <filter id="g-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3.5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="g-face" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#12467f" stopOpacity="0.55" />
            <stop offset="1" stopColor="#071e3a" stopOpacity="0.15" />
          </radialGradient>
        </defs>
        <circle cx="150" cy="150" r="146" fill="url(#g-face)" stroke="#fff" strokeOpacity="0.2" strokeWidth="2" />
        <g className="ls-spin" style={{ transformOrigin: "150px 150px", animationDuration: "30s" }}>
          <circle cx="150" cy="150" r="68" fill="none" stroke={BLUE} strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="2 9" />
        </g>
        <path d={`M${f(ax)} ${f(ay)} A141 141 0 0 1 ${f(bx)} ${f(by)}`} fill="none" stroke="#ED1C24" strokeWidth="5" strokeOpacity="0.95" strokeLinecap="round" />
        {ticks.map((t, i) => (
          <line key={i} x1={f(t.x1)} y1={f(t.y1)} x2={f(t.x2)} y2={f(t.y2)} stroke={t.red ? "#ff6a70" : "#fff"} strokeOpacity={t.major ? 0.9 : 0.35} strokeWidth={t.major ? 2.2 : 1} />
        ))}
        {labels.map((l) => (
          <text key={l.v} x={f(l.x)} y={f(l.y)} textAnchor="middle" dominantBaseline="central" fontSize="15" fontWeight="600" fill={l.v >= 7 ? "#ff6a70" : "#fff"} fillOpacity="0.9">
            {l.v}
          </text>
        ))}
        <text x="150" y="108" textAnchor="middle" fontSize="9" letterSpacing="3" fill="#FDC400" fillOpacity="0.9">
          SUPER DRIVE
        </text>
        <text ref={readout} x="150" y="206" textAnchor="middle" fontSize="22" fontWeight="700" fill="#FDC400">
          3.0
        </text>
        <text x="150" y="222" textAnchor="middle" fontSize="8" letterSpacing="3" fill="#fff" fillOpacity="0.55">
          R/MIN × 1000
        </text>
        <g ref={needle} transform={`rotate(${f(-135 + 3 * SPAN)} 150 150)`}>
          <line x1="150" y1="164" x2="150" y2="48" stroke="#FDC400" strokeWidth="3.2" strokeLinecap="round" filter="url(#g-glow)" />
        </g>
        <circle cx="150" cy="150" r="14" fill="#0b2f55" stroke="#FDC400" strokeWidth="3" />
        <circle cx="150" cy="150" r="4.5" fill="#FDC400" />
      </svg>

      <svg className="ls-engine-svg" viewBox="0 0 300 290" role="presentation" focusable="false">
        <defs>
          <radialGradient id="e-flash" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#fff6c2" stopOpacity="1" />
            <stop offset="0.35" stopColor="#FDC400" stopOpacity="0.85" />
            <stop offset="1" stopColor="#ED1C24" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* holographic base ring */}
        <g className="ls-spin" style={{ transformOrigin: `${CX}px ${CY}px`, animationDuration: "40s" }}>
          <circle cx={CX} cy={CY} r="78" fill="none" stroke={BLUE} strokeOpacity="0.3" strokeWidth="1.5" strokeDasharray="3 8" />
        </g>
        <circle cx={CX} cy={CY} r="60" fill="rgba(10,40,80,0.35)" stroke={BLUE} strokeOpacity="0.55" strokeWidth="1.5" />

        {/* oil pan with oil and falling drops */}
        <path d="M100 236 L200 236 L190 268 Q150 278 110 268 Z" fill="rgba(253,196,0,0.16)" stroke="#FDC400" strokeOpacity="0.65" strokeWidth="1.5" />
        <path className="ls-oil" d="M104 252 Q116 246 128 252 T152 252 T176 252 T198 252 L190 266 Q150 275 110 266 Z" fill="#FDC400" fillOpacity="0.45" />
        <text x="150" y="264" textAnchor="middle" fontSize="7" letterSpacing="1.6" fill="#FDC400" fillOpacity="0.9">
          SUPER DRIVE OIL
        </text>
        {[128, 150, 172].map((x, i) => (
          <circle key={x} className="ls-drip" cx={x} cy="226" r="3" fill="#FDC400" style={{ animationDelay: `${i * 0.5}s` }} />
        ))}

        {/* cylinders */}
        {PHI.map((phi, i) => {
          const g = geo(0, phi);
          return (
            <g key={phi} transform={`rotate(${phi} ${CX} ${CY})`}>
              <rect x={CX - 24} y={CY - 138} width="48" height="100" rx="3" fill="rgba(20,70,130,0.22)" stroke={BLUE} strokeOpacity="0.8" strokeWidth="1.6" />
              {Array.from({ length: 6 }, (_, k) => {
                const y = CY - 128 + k * 14;
                return <path key={k} d={`M${CX - 31} ${y} L${CX - 24} ${y} M${CX + 24} ${y} L${CX + 31} ${y}`} stroke={BLUE} strokeOpacity="0.55" strokeWidth="2" />;
              })}
              <rect x={CX - 27} y={CY - 150} width="54" height="12" rx="3" fill="rgba(20,70,130,0.5)" stroke={BLUE} strokeOpacity="0.9" strokeWidth="1.6" />
              <line x1={CX} y1={CY - 150} x2={CX} y2={CY - 160} stroke="#cbd5e1" strokeWidth="3" strokeLinecap="round" />
              <circle ref={(el) => void (flashes.current[i] = el)} cx={CX} cy={CY - 132} r="24" fill="url(#e-flash)" opacity="0" />
              <line ref={(el) => void (rods.current[i] = el)} x1={CX} y1={f(CY + g.py)} x2={f(CX + g.lx)} y2={f(CY + g.ly)} stroke="#d8e2f0" strokeWidth="5" strokeLinecap="round" />
              <g ref={(el) => void (pistons.current[i] = el)} transform={`translate(0 ${f(g.py)})`}>
                <rect x={CX - 21} y={CY - 13} width="42" height="26" rx="3" fill="rgba(60,130,220,0.45)" stroke="#bcd6ff" strokeWidth="1.6" />
                <path d={`M${CX - 21} ${CY - 6} H${CX + 21} M${CX - 21} ${CY - 1} H${CX + 21}`} stroke="#bcd6ff" strokeOpacity="0.7" strokeWidth="1" />
                <circle cx={CX} cy={CY + 5} r="3.5" fill="#FDC400" />
              </g>
            </g>
          );
        })}

        {/* crankshaft */}
        <g ref={crank} transform={`rotate(0 ${CX} ${CY})`}>
          <circle cx={CX} cy={CY} r="36" fill="rgba(7,30,58,0.75)" stroke="#FDC400" strokeOpacity="0.6" strokeWidth="1.8" />
          <circle cx={CX} cy={CY + 22} r="15" fill="rgba(253,196,0,0.3)" stroke="#FDC400" strokeOpacity="0.8" strokeWidth="1.4" />
          <line x1={CX} y1={CY} x2={CX} y2={CY - R} stroke="#FDC400" strokeOpacity="0.8" strokeWidth="6" strokeLinecap="round" />
          <circle cx={CX} cy={CY - R} r="7.5" fill="#FDC400" />
        </g>
        <circle cx={CX} cy={CY} r="6" fill="#0b2f55" stroke="#FDC400" strokeWidth="2" />
      </svg>
    </div>
  );
}
