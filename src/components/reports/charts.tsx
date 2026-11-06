import type { CSSProperties, ReactNode } from "react";
import type { Health } from "@/lib/reports/health";
import { GOLD, INK, LINE, MUTED, NAVY } from "./EndOfDaySheet";

/**
 * Graphs for the paper report: plain SVG and inline styles only, so they print (or save as PDF) exactly as they look on screen.
 */
export const PALETTE = ["#2f6fd0", "#e0a800", "#16a34a", "#ed1c24", "#7c3aed", "#0891b2", "#64748b", "#f97316"];
export const STATUS_COLOR = { good: "#16a34a", ok: "#d99a00", bad: "#dc2626" } as const;

const short = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`;
  if (a >= 1_000) return `${(v / 1_000).toFixed(a >= 10_000 ? 0 : 1)}K`;
  return String(Math.round(v));
};

/** A half-circle meter with the score in the middle. */
export function Gauge({ score, color, label }: { score: number; color: string; label: string }) {
  const cx = 110;
  const cy = 104;
  const r = 84;
  const f = Math.min(1, Math.max(0, score / 100));
  const a = Math.PI - Math.PI * f;
  const x = cx + r * Math.cos(a);
  const y = cy - r * Math.sin(a);
  return (
    <svg viewBox="0 0 220 140" width="100%" style={{ display: "block", maxWidth: 230 }} role="img" aria-label={`Business health ${score} out of 100, ${label}`}>
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="#e5e7eb" strokeWidth={16} strokeLinecap="round" />
      {f > 0 && <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`} fill="none" stroke={color} strokeWidth={16} strokeLinecap="round" />}
      <text x={cx} y={cy - 12} textAnchor="middle" fontSize={44} fontWeight={800} fill={INK} fontFamily="Inter, system-ui, sans-serif">
        {score}
      </text>
      <text x={cx} y={cy + 8} textAnchor="middle" fontSize={11} fill={MUTED} fontFamily="Inter, system-ui, sans-serif">
        out of 100
      </text>
      <text x={cx} y={cy + 30} textAnchor="middle" fontSize={15} fontWeight={700} fill={color} fontFamily="Inter, system-ui, sans-serif">
        {label}
      </text>
    </svg>
  );
}

/** The six health indicators as rows with a small bar, then what to do next. */
export function HealthBlock({ health }: { health: Health }) {
  const color = STATUS_COLOR[health.tone];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "230px 1fr", gap: 22, alignItems: "center", marginTop: 12 }}>
      <div style={{ textAlign: "center" }}>
        <Gauge score={health.score} color={color} label={health.label} />
      </div>
      <div>
        {health.indicators.map((ind) => (
          <div key={ind.key} style={{ display: "grid", gridTemplateColumns: "150px 1fr 60px", alignItems: "center", gap: 10, padding: "4px 0" }}>
            <div style={{ fontSize: 11.5, color: INK, lineHeight: 1.25 }}>
              {ind.label}
              <div style={{ fontSize: 9, color: MUTED }}>{ind.note}</div>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: "#eceff3", overflow: "hidden" }}>
              <div style={{ width: `${Math.max(ind.score, 3)}%`, height: "100%", background: STATUS_COLOR[ind.status], borderRadius: 4 }} />
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, textAlign: "right", color: STATUS_COLOR[ind.status], fontVariantNumeric: "tabular-nums" }}>{ind.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Two lines over the same days: this period (filled) and the one before (dashed). */
export function LineChart({ labels, current, previous, currentName, previousName }: { labels: string[]; current: number[]; previous: number[] | null; currentName: string; previousName: string }) {
  const W = 780;
  const H = 200;
  const L = 46;
  const R = 10;
  const T = 12;
  const B = 24;
  const n = Math.max(current.length, 1);
  const max = Math.max(1, ...current, ...(previous ?? []));
  const top = niceCeil(max / 4) * 4; // four even steps, so the axis numbers are round
  const x = (i: number) => L + (n === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const path = (vals: number[]) => vals.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const every = Math.max(1, Math.ceil(n / 10));
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }} role="img" aria-label="Sales over time">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(top * t)} y2={y(top * t)} stroke={t === 0 ? LINE : "#eef0f3"} strokeWidth={1} />
            <text x={L - 6} y={y(top * t) + 3} textAnchor="end" fontSize={9.5} fill={MUTED} fontFamily="Inter, system-ui, sans-serif">
              {short(top * t)}
            </text>
          </g>
        ))}
        {current.length > 1 && <path d={`${path(current)} L ${x(current.length - 1).toFixed(1)} ${y(0)} L ${x(0).toFixed(1)} ${y(0)} Z`} fill={NAVY} opacity={0.1} />}
        {previous && previous.length > 1 && <path d={path(previous)} fill="none" stroke="#94a3b8" strokeWidth={1.8} strokeDasharray="5 4" />}
        <path d={path(current)} fill="none" stroke={NAVY} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
        {current.map((v, i) => (current.length <= 31 ? <circle key={i} cx={x(i)} cy={y(v)} r={2.4} fill={NAVY} /> : null))}
        {labels.map((l, i) =>
          i % every === 0 ? (
            <text key={i} x={x(i)} y={H - 7} textAnchor="middle" fontSize={9.5} fill={MUTED} fontFamily="Inter, system-ui, sans-serif">
              {l}
            </text>
          ) : null,
        )}
      </svg>
      <div style={{ display: "flex", gap: 18, fontSize: 10.5, color: MUTED, marginTop: 2 }}>
        <span>
          <span style={{ display: "inline-block", width: 16, height: 3, background: NAVY, verticalAlign: "middle", marginRight: 6 }} />
          {currentName}
        </span>
        {previous && (
          <span>
            <span style={{ display: "inline-block", width: 16, borderTop: "2px dashed #94a3b8", verticalAlign: "middle", marginRight: 6 }} />
            {previousName}
          </span>
        )}
      </div>
    </div>
  );
}

function niceCeil(v: number) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  return ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((x) => m <= x) ?? 10) * p;
}

/** Horizontal bars, biggest first: a label, the bar, and the amount. */
export function HBars({ rows }: { rows: { label: string; value: number; text: string; note?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div style={{ marginTop: 10 }}>
      {rows.map((r, i) => (
        <div key={r.label} style={{ display: "grid", gridTemplateColumns: "170px 1fr 150px", alignItems: "center", gap: 10, padding: "3.5px 0" }}>
          <div style={{ fontSize: 11.5, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.label}</div>
          <div style={{ height: 11, borderRadius: 3, background: "#eef0f3", overflow: "hidden" }}>
            <div style={{ width: `${Math.max((r.value / max) * 100, r.value > 0 ? 2 : 0)}%`, height: "100%", background: i === 0 ? GOLD : PALETTE[0], opacity: i === 0 ? 1 : 0.85, borderRadius: 3 }} />
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 600, textAlign: "right", color: INK, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            {r.text}
            {r.note && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 400, color: MUTED }}>{r.note}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A ring split into slices, with the total in the middle and a legend. */
export function Donut({ slices, centre, centreSub }: { slices: { label: string; value: number; text: string }[]; centre: string; centreSub: string }) {
  const total = slices.reduce((t, s) => t + s.value, 0) || 1;
  const r = 46;
  const c = 2 * Math.PI * r;
  let acc = 0;
  const wrap: CSSProperties = { display: "grid", gridTemplateColumns: "170px 1fr", gap: 20, alignItems: "center", marginTop: 10 };
  return (
    <div style={wrap}>
      <svg viewBox="0 0 120 120" width="100%" style={{ display: "block", maxWidth: 170 }} role="img" aria-label={centreSub}>
        <g transform="rotate(-90 60 60)">
          <circle cx={60} cy={60} r={r} fill="none" stroke="#eef0f3" strokeWidth={17} />
          {slices.map((s, i) => {
            const len = (s.value / total) * c;
            const el = <circle key={s.label} cx={60} cy={60} r={r} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth={17} strokeDasharray={`${Math.max(len - 1.5, 0.5)} ${c}`} strokeDashoffset={-acc} />;
            acc += len;
            return el;
          })}
        </g>
        <text x={60} y={58} textAnchor="middle" fontSize={centre.length > 11 ? 10 : 12.5} fontWeight={800} fill={INK} fontFamily="Inter, system-ui, sans-serif">
          {centre}
        </text>
        <text x={60} y={72} textAnchor="middle" fontSize={7.5} fill={MUTED} fontFamily="Inter, system-ui, sans-serif">
          {centreSub}
        </text>
      </svg>
      <div>
        {slices.map((s, i) => (
          <div key={s.label} style={{ display: "grid", gridTemplateColumns: "12px 1fr auto 40px", alignItems: "center", gap: 8, padding: "3px 0", fontSize: 11.5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: PALETTE[i % PALETTE.length] }} />
            <span style={{ color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
            <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{s.text}</span>
            <span style={{ textAlign: "right", color: MUTED, fontVariantNumeric: "tabular-nums" }}>{Math.round((s.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** What stands out: one line each, coloured by whether it is good news, a warning or just information. */
export function Notes({ items }: { items: { tone: "good" | "warn" | "info"; text: string; estimate?: boolean }[] }): ReactNode {
  const look = { good: { bg: "#ecfdf3", bar: "#16a34a", ink: "#14532d" }, warn: { bg: "#fff8e6", bar: "#d99a00", ink: "#713f12" }, info: { bg: "#f3f4f6", bar: "#94a3b8", ink: "#374151" } } as const;
  return (
    <div style={{ marginTop: 10, display: "grid", gap: 5 }}>
      {items.map((n, i) => (
        <div key={i} style={{ background: look[n.tone].bg, borderLeft: `4px solid ${look[n.tone].bar}`, borderRadius: 4, padding: "6px 10px", fontSize: 11.5, color: look[n.tone].ink, lineHeight: 1.4, breakInside: "avoid" }}>
          {n.text}
          {n.estimate && <span style={{ marginLeft: 8, fontSize: 9, color: MUTED }}>(estimate)</span>}
        </div>
      ))}
    </div>
  );
}
