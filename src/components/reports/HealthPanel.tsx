import { CheckCircle2, CircleAlert, TriangleAlert } from "lucide-react";
import type { Health, HealthStatus } from "@/lib/reports/health";
import { cn } from "@/lib/utils";

const TONE: Record<HealthStatus, { text: string; bar: string; stroke: string }> = {
  good: { text: "text-emerald-600", bar: "bg-emerald-500", stroke: "#10b981" },
  ok: { text: "text-amber-600", bar: "bg-amber-500", stroke: "#f59e0b" },
  bad: { text: "text-rose-600", bar: "bg-rose-500", stroke: "#ef4444" },
};

/** A half-circle meter with the score inside. `onDark` for the navy banner. */
export function HealthGauge({ health, size = 220, onDark = false }: { health: Health; size?: number; onDark?: boolean }) {
  const cx = 110;
  const cy = 104;
  const r = 84;
  const f = Math.min(1, Math.max(0, health.score / 100));
  const a = Math.PI - Math.PI * f;
  const x = cx + r * Math.cos(a);
  const y = cy - r * Math.sin(a);
  const color = TONE[health.tone].stroke;
  return (
    <svg viewBox="0 0 220 140" width={size} height={(size * 140) / 220} role="img" aria-label={`Business health ${health.score} out of 100, ${health.label}`} className="block shrink-0">
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke={onDark ? "rgba(255,255,255,0.14)" : "currentColor"} className={onDark ? undefined : "text-slate-200"} strokeWidth={16} strokeLinecap="round" />
      {f > 0 && <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`} fill="none" stroke={color} strokeWidth={16} strokeLinecap="round" />}
      <text x={cx} y={cy - 12} textAnchor="middle" fontSize={44} fontWeight={800} fill="currentColor" className={onDark ? "text-white" : "text-slate-900"}>
        {health.score}
      </text>
      <text x={cx} y={cy + 8} textAnchor="middle" fontSize={11} fill="currentColor" className={onDark ? "text-white/60" : "text-slate-500"}>
        out of 100
      </text>
      <text x={cx} y={cy + 30} textAnchor="middle" fontSize={15} fontWeight={700} fill={color}>
        {health.label}
      </text>
    </svg>
  );
}

/** How the business is doing: the score, the six things behind it, and what to do next. */
export default function HealthPanel({ health }: { health: Health }) {
  return (
    <section className="card card-pad mb-5" aria-label="Business health">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">How healthy is the business?</h2>
        <p className="text-xs text-slate-500">One score from growth, profit, spending, collections, debts and stock</p>
      </div>
      <div className="mt-4 grid items-center gap-6 lg:grid-cols-[240px_1fr]">
        <div className="flex justify-center">
          <HealthGauge health={health} />
        </div>
        <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          {health.indicators.map((ind) => (
            <li key={ind.key}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-slate-800">{ind.label}</span>
                <span className={cn("text-sm font-semibold tabular-nums", TONE[ind.status].text)}>{ind.value}</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className={cn("h-full rounded-full", TONE[ind.status].bar)} style={{ width: `${Math.max(ind.score, 3)}%` }} />
              </div>
              <p className="mt-0.5 text-[11px] text-slate-500">{ind.note}</p>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-5 rounded-xl border border-line bg-slate-50 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">What to do next</p>
        <ul className="mt-2 space-y-1.5">
          {health.advice.map((a, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-slate-800">
              {health.tone === "good" && health.indicators.every((x) => x.status === "good") ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" /> : health.tone === "bad" ? <TriangleAlert size={16} className="mt-0.5 shrink-0 text-rose-600" /> : <CircleAlert size={16} className="mt-0.5 shrink-0 text-amber-600" />}
              <span>{a}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
