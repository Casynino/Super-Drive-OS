// Three side-view vehicles for the sign-in scene: a red sports car, a yellow pickup carrying oil barrels and a
// Super Drive Oil tanker truck. All share one ground line and wheel size, so they can drive in different lanes.

function Wheel({ cx }: { cx: number }) {
  return (
    <g transform={`translate(${cx} 98)`}>
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
  );
}

/** Gradients, glow and blur shared by one vehicle. `id` keeps the ids unique on the page. */
function Defs({ id, body }: { id: string; body: [string, string, string] }) {
  return (
    <defs>
      <linearGradient id={`body-${id}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={body[0]} />
        <stop offset="0.45" stopColor={body[1]} />
        <stop offset="1" stopColor={body[2]} />
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
        <stop offset="0" stopColor="#FDC400" stopOpacity="0.5" />
        <stop offset="1" stopColor="#FDC400" stopOpacity="0" />
      </radialGradient>
      <filter id={`blur-${id}`} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="5" />
      </filter>
    </defs>
  );
}

function Arches({ id, at }: { id: string; at: number[] }) {
  return (
    <mask id={`arch-${id}`}>
      <rect width="960" height="190" fill="#fff" />
      {at.map((cx) => (
        <circle key={cx} cx={cx} cy="98" r="31" fill="#000" />
      ))}
    </mask>
  );
}

function Lights({ id, front, tail }: { id: string; front: number; tail: number }) {
  return (
    <>
      <rect x={tail} y="72" width="7" height="9" rx="2" fill="#ff2b33" />
      <rect className="ls-tail" x={tail - 8} y="70" width="22" height="13" rx="6" fill="#ED1C24" opacity="0.6" filter={`url(#blur-${id})`} />
      <path d={`M${front - 14} 70 L${front + 3} 75 L${front + 1} 82 L${front - 17} 79 Z`} fill="#FDC400" />
      <ellipse cx={front} cy="78" rx="14" ry="9" fill="#FDC400" opacity="0.7" filter={`url(#blur-${id})`} />
    </>
  );
}

export function SportsCar() {
  const id = "car";
  return (
    <svg className="ls-veh-svg" viewBox="0 0 760 190" role="presentation" focusable="false">
      <Defs id={id} body={["#ff5a60", "#ED1C24", "#8f0d13"]} />
      <defs>
        <Arches id={id} at={[95, 305]} />
      </defs>
      <g transform="translate(30 32)">
        <polygon className="ls-beam" points="378,76 710,22 710,126" fill={`url(#beam-${id})`} />
        <ellipse cx="200" cy="126" rx="200" ry="14" fill={`url(#glow-${id})`} />
        <ellipse cx="200" cy="126" rx="176" ry="5" fill="#000" opacity="0.55" />
        <g className="ls-car">
          <g mask={`url(#arch-${id})`}>
            <path d="M24 96 L26 78 Q27 68 40 66 L112 60 Q140 36 190 32 L252 32 Q286 34 306 58 L352 64 Q374 68 378 82 L380 96 Z" fill={`url(#body-${id})`} />
            <path d="M24 90 L380 90 L380 96 L24 96 Z" fill="#05101f" opacity="0.55" />
          </g>
          <path d="M142 58 Q158 42 192 40 L246 40 Q268 42 284 58 Z" fill={`url(#glass-${id})`} />
          <path d="M214 40 L214 58" stroke="#8f0d13" strokeWidth="3" />
          <path d="M46 72 Q180 62 340 68" stroke="#fff" strokeOpacity="0.4" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          <path d="M214 60 L214 90 M150 60 L150 90" stroke="#5c080c" strokeOpacity="0.7" strokeWidth="1.2" />
          <Lights id={id} front={380} tail={22} />
          <Wheel cx={95} />
          <Wheel cx={305} />
        </g>
      </g>
    </svg>
  );
}

export function Pickup() {
  const id = "pick";
  return (
    <svg className="ls-veh-svg" viewBox="0 0 760 190" role="presentation" focusable="false">
      <Defs id={id} body={["#ffe46b", "#FDC400", "#a87c00"]} />
      <defs>
        <Arches id={id} at={[92, 310]} />
      </defs>
      <g transform="translate(30 32)">
        <polygon className="ls-beam" points="378,76 710,22 710,126" fill={`url(#beam-${id})`} />
        <ellipse cx="200" cy="126" rx="200" ry="14" fill={`url(#glow-${id})`} />
        <ellipse cx="200" cy="126" rx="176" ry="5" fill="#000" opacity="0.55" />
        <g className="ls-car">
          {/* cargo: oil barrels in the bed */}
          {[34, 70, 106].map((x) => (
            <g key={x}>
              <rect x={x} y="34" width="30" height="28" rx="5" fill="#0E3D6E" stroke="#082340" strokeWidth="1.2" />
              <rect x={x} y="42" width="30" height="4" fill="#ED1C24" />
              <rect x={x} y="52" width="30" height="3" fill="#FDC400" />
            </g>
          ))}
          <g mask={`url(#arch-${id})`}>
            <path d="M18 96 L18 66 Q18 60 26 60 L168 58 L186 32 Q192 27 202 27 L262 27 Q282 29 294 52 L350 62 Q372 66 378 80 L380 96 Z" fill={`url(#body-${id})`} />
            <path d="M18 90 L380 90 L380 96 L18 96 Z" fill="#05101f" opacity="0.55" />
          </g>
          <path d="M26 58 L166 57 L166 64 L26 65 Z" fill="#3b2a00" opacity="0.85" />
          <path d="M190 56 L205 34 L262 34 Q278 36 288 56 Z" fill={`url(#glass-${id})`} />
          <path d="M236 34 L236 56" stroke="#a87c00" strokeWidth="3" />
          <path d="M176 66 L176 90 M250 62 L250 90" stroke="#7a5a00" strokeOpacity="0.7" strokeWidth="1.2" />
          {/* roof light bar */}
          <rect x="212" y="21" width="44" height="6" rx="2" fill="#1f2937" />
          {[218, 228, 238, 248].map((x, i) => (
            <circle key={x} className="ls-blink" cx={x} cy="24" r="2" fill={i % 2 ? "#6fb0ff" : "#ff5a60"} style={{ animationDelay: `${i * 0.18}s` }} />
          ))}
          <Lights id={id} front={380} tail={16} />
          <Wheel cx={92} />
          <Wheel cx={310} />
        </g>
      </g>
    </svg>
  );
}

export function Tanker() {
  const id = "tank";
  return (
    <svg className="ls-veh-svg" viewBox="0 0 960 190" role="presentation" focusable="false">
      <Defs id={id} body={["#2f78c9", "#0E3D6E", "#06223f"]} />
      <defs>
        <linearGradient id="tank-shell" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor="#e3eaf4" />
          <stop offset="1" stopColor="#9fb0c6" />
        </linearGradient>
        <clipPath id="tank-clip">
          <rect x="36" y="22" width="392" height="64" rx="30" />
        </clipPath>
        <Arches id={id} at={[466, 536]} />
      </defs>
      <g transform="translate(30 32)">
        <polygon className="ls-beam" points="572,78 900,24 900,128" fill={`url(#beam-${id})`} />
        <ellipse cx="300" cy="126" rx="300" ry="14" fill={`url(#glow-${id})`} />
        <ellipse cx="300" cy="126" rx="280" ry="5" fill="#000" opacity="0.55" />
        <g className="ls-car">
          <rect x="22" y="84" width="552" height="12" fill="#0b1220" />
          {/* exhaust stack and smoke */}
          <rect x="424" y="4" width="8" height="48" fill="#94a3b8" />
          {[0, 1, 2].map((i) => (
            <circle key={i} className="ls-puff" cx="428" cy="2" r="6" fill="#cbd5e1" style={{ animationDelay: `${i * 0.7}s` }} />
          ))}
          {/* tank */}
          <rect x="36" y="22" width="392" height="64" rx="30" fill="url(#tank-shell)" stroke="#94a3b8" strokeWidth="1.5" />
          <g clipPath="url(#tank-clip)">
            <rect x="36" y="56" width="392" height="14" fill="#0E3D6E" />
            <rect x="36" y="52" width="392" height="4" fill="#ED1C24" />
            <rect x="36" y="70" width="392" height="3" fill="#FDC400" />
          </g>
          <text x="232" y="46" textAnchor="middle" fontSize="19" fontWeight="800" fontStyle="italic" fill="#0E3D6E" letterSpacing="1">
            SUPER DRIVE OIL
          </text>
          {[100, 210, 320].map((x) => (
            <rect key={x} x={x} y="14" width="28" height="9" rx="3" fill="#64748b" />
          ))}
          <rect x="420" y="70" width="26" height="14" fill="#0b1220" />
          {/* cab */}
          <g mask={`url(#arch-${id})`}>
            <path d="M436 96 L436 44 Q436 34 448 34 L490 34 Q508 36 522 58 L556 64 Q570 68 573 82 L574 96 Z" fill={`url(#body-${id})`} />
            <path d="M436 90 L574 90 L574 96 L436 96 Z" fill="#05101f" opacity="0.55" />
          </g>
          <path d="M456 58 L466 42 L488 42 Q500 44 510 58 Z" fill={`url(#glass-${id})`} />
          <path d="M440 76 L568 80" stroke="#FDC400" strokeWidth="3" strokeLinecap="round" />
          <path d="M440 70 L564 74" stroke="#ED1C24" strokeWidth="2" strokeLinecap="round" />
          <Lights id={id} front={573} tail={26} />
          <Wheel cx={130} />
          <Wheel cx={190} />
          <Wheel cx={466} />
          <Wheel cx={536} />
        </g>
      </g>
    </svg>
  );
}
