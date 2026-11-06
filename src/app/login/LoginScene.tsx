import type { CSSProperties } from "react";

// Decorative animated scene for the sign-in page: a red sports car driving on a glowing grid road, a revving
// gauge and slowly turning gears. Pure SVG + CSS (see login.css), no images, no scripts. aria-hidden.

const f = (n: number) => n.toFixed(1);
/** Point on a circle; angle in degrees, 0 = straight up, clockwise. */
const pt = (cx: number, cy: number, r: number, g: number) => {
  const a = (g * Math.PI) / 180;
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)] as const;
};

function gearPath(cx: number, cy: number, teeth: number, rOuter: number, rRoot: number) {
  const step = (Math.PI * 2) / teeth;
  const w1 = step * 0.3;
  const w2 = step * 0.17;
  const pts: string[] = [];
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    for (const [ang, r] of [[a - w1, rRoot], [a - w2, rOuter], [a + w2, rOuter], [a + w1, rRoot]] as const) {
      pts.push(`${f(cx + r * Math.cos(ang))} ${f(cy + r * Math.sin(ang))}`);
    }
  }
  return `M${pts.join(" L")} Z`;
}

const vars = (v: Record<string, string>) => v as CSSProperties;

const DOTS = [
  ["8%", "11s", "-2s"], ["19%", "14s", "-9s"], ["31%", "10s", "-5s"], ["43%", "16s", "-12s"], ["55%", "12s", "-1s"],
  ["66%", "15s", "-7s"], ["77%", "11s", "-10s"], ["88%", "13s", "-4s"], ["95%", "17s", "-14s"],
];
const STREAKS = [
  ["66%", "150px", "1.7s", "-0.3s"], ["72%", "90px", "1.2s", "-0.9s"], ["78%", "210px", "2.1s", "-1.4s"],
  ["84%", "120px", "1.5s", "-0.6s"], ["90%", "180px", "1.9s", "-1.1s"], ["95%", "100px", "1.3s", "-0.2s"],
];

function Car({ id }: { id: string }) {
  return (
    <svg className="ls-car-svg" viewBox="0 0 760 190" role="presentation" focusable="false">
      <defs>
        <linearGradient id={`body-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff5a60" />
          <stop offset="0.45" stopColor="#ED1C24" />
          <stop offset="1" stopColor="#8f0d13" />
        </linearGradient>
        <linearGradient id={`glass-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6fb0ff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#0b2f55" />
        </linearGradient>
        <linearGradient id={`beam-${id}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#FDC400" stopOpacity="0.55" />
          <stop offset="1" stopColor="#FDC400" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`glow-${id}`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#FDC400" stopOpacity="0.55" />
          <stop offset="1" stopColor="#FDC400" stopOpacity="0" />
        </radialGradient>
        <mask id={`arch-${id}`}>
          <rect width="760" height="190" fill="#fff" />
          <circle cx="95" cy="98" r="31" fill="#000" />
          <circle cx="305" cy="98" r="31" fill="#000" />
        </mask>
        <filter id={`blur-${id}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>

      <g transform="translate(30 32)">
        {/* light beam, shadow and underglow */}
        <polygon className="ls-beam" points="378,76 710,22 710,126" fill={`url(#beam-${id})`} />
        <ellipse cx="200" cy="126" rx="200" ry="14" fill={`url(#glow-${id})`} />
        <ellipse cx="200" cy="126" rx="176" ry="5" fill="#000" opacity="0.55" />

        <g className="ls-car">
          {/* body */}
          <g mask={`url(#arch-${id})`}>
            <path d="M24 96 L26 78 Q27 68 40 66 L112 60 Q140 36 190 32 L252 32 Q286 34 306 58 L352 64 Q374 68 378 82 L380 96 Z" fill={`url(#body-${id})`} />
            <path d="M24 90 L380 90 L380 96 L24 96 Z" fill="#05101f" opacity="0.55" />
          </g>
          {/* cabin glass */}
          <path d="M142 58 Q158 42 192 40 L246 40 Q268 42 284 58 Z" fill={`url(#glass-${id})`} />
          <path d="M214 40 L214 58" stroke="#8f0d13" strokeWidth="3" />
          {/* shoulder highlight and door line */}
          <path d="M46 72 Q180 62 340 68" stroke="#fff" strokeOpacity="0.4" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          <path d="M214 60 L214 90 M150 60 L150 90" stroke="#5c080c" strokeOpacity="0.7" strokeWidth="1.2" />
          {/* lights */}
          <rect x="22" y="72" width="7" height="9" rx="2" fill="#ff2b33" />
          <rect className="ls-tail" x="14" y="70" width="22" height="13" rx="6" fill="#ED1C24" opacity="0.6" filter={`url(#blur-${id})`} />
          <path d="M366 70 L383 75 L381 82 L363 79 Z" fill="#FDC400" />
          <ellipse cx="380" cy="78" rx="14" ry="9" fill="#FDC400" opacity="0.7" filter={`url(#blur-${id})`} />
          {/* wheels */}
          {[95, 305].map((cx) => (
            <g key={cx} transform={`translate(${cx} 98)`}>
              <circle r="26" fill="#070b14" stroke="#243247" strokeWidth="2" />
              <circle r="18" fill="#1b2638" stroke="#94a3b8" strokeWidth="1.5" />
              <g className="ls-spin ls-wheel">
                {[0, 72, 144, 216, 288].map((a) => (
                  <line key={a} x1="0" y1="0" x2="0" y2="-16" stroke="#cbd5e1" strokeWidth="3" strokeLinecap="round" transform={`rotate(${a})`} />
                ))}
                <circle cx="0" cy="-12" r="2.2" fill="#FDC400" />
              </g>
              <circle r="4.5" fill="#FDC400" />
            </g>
          ))}
        </g>
      </g>
    </svg>
  );
}

function Gauge() {
  const SPAN = 33.75; // degrees per 1000 r/min
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

  return (
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
      <g className="ls-spin ls-ring">
        <circle cx="150" cy="150" r="68" fill="none" stroke="#7fb2ff" strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="2 9" />
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
      <text x="150" y="196" textAnchor="middle" fontSize="9" letterSpacing="3" fill="#fff" fillOpacity="0.55">
        R/MIN × 1000
      </text>
      <text x="150" y="108" textAnchor="middle" fontSize="9" letterSpacing="3" fill="#FDC400" fillOpacity="0.9">
        SUPER DRIVE
      </text>
      <g className="ls-needle">
        <line x1="150" y1="164" x2="150" y2="48" stroke="#FDC400" strokeWidth="3.2" strokeLinecap="round" filter="url(#g-glow)" />
      </g>
      <circle cx="150" cy="150" r="14" fill="#0b2f55" stroke="#FDC400" strokeWidth="3" />
      <circle cx="150" cy="150" r="4.5" fill="#FDC400" />
    </svg>
  );
}

function Gears() {
  return (
    <svg className="ls-gears-svg" viewBox="0 0 320 240" role="presentation" focusable="false">
      <g fill="none" stroke="#9cc3ff" strokeWidth="1.6" strokeLinejoin="round">
        <g className="ls-spin ls-gear-a">
          <path d={gearPath(110, 120, 14, 92, 76)} />
          <circle cx="110" cy="120" r="30" />
          <circle cx="110" cy="120" r="8" />
        </g>
        <g transform="rotate(22.5 242 120)">
          <g className="ls-spin ls-gear-b">
            <path d={gearPath(242, 120, 8, 54, 42)} />
            <circle cx="242" cy="120" r="17" />
            <circle cx="242" cy="120" r="5" />
          </g>
        </g>
      </g>
    </svg>
  );
}

export default function LoginScene({ variant = "full" }: { variant?: "full" | "compact" }) {
  const full = variant === "full";
  return (
    <div className={`ls ${full ? "ls-full" : "ls-compact"}`} aria-hidden="true">
      {full && <Gears />}
      {full && (
        <div className="ls-gauge">
          <Gauge />
        </div>
      )}
      {DOTS.map(([l, d, s], i) => (
        <span key={i} className="ls-dot" style={vars({ "--l": l, "--d": d, "--s": s })} />
      ))}
      <div className="ls-horizon" />
      <div className="ls-floor">
        <div className="ls-grid" />
      </div>
      {STREAKS.map(([t, w, d, s], i) => (
        <span key={i} className="ls-streak" style={vars({ "--t": t, "--w": w, "--d": d, "--s": s })} />
      ))}
      <div className="ls-car-wrap">
        <Car id={variant} />
      </div>
    </div>
  );
}
