"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Brand-led palette: navy, red, oil yellow, then supporting tones.
export const CHART_COLORS = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)", "var(--c7)"];

type Money = { symbol: string; decimals: number };
const fmt = (n: number, m: Money) => `${m.symbol} ${new Intl.NumberFormat("en-US", { maximumFractionDigits: m.decimals }).format(n)}`;
const short = (n: number) => (Math.abs(n) >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : Math.abs(n) >= 1_000 ? `${Math.round(n / 1_000)}k` : String(Math.round(n)));

function Empty({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center text-sm text-slate-400">{text}</div>;
}

export function SalesTrendChart({ data, money }: { data: { label: string; sales: number; count: number }[]; money: Money }) {
  if (data.every((d) => d.sales === 0)) return <Empty text="No sales in this period yet" />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--c1)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--c1)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 4" stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--chart-text)" }} interval="preserveStartEnd" />
        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--chart-text)" }} tickFormatter={short} width={44} />
        <Tooltip
          cursor={{ stroke: "var(--c1)", strokeDasharray: 4 }}
          formatter={(v) => [fmt(Number(v), money), "Sales"]}
          labelFormatter={(l, p) => `${l} · ${p?.[0]?.payload?.count ?? 0} sale(s)`}
          contentStyle={{ borderRadius: 10, border: "1px solid var(--chart-grid)", background: "var(--card)", color: "var(--chart-label)", boxShadow: "0 6px 20px rgba(15,27,45,.12)" }}
        />
        <Area type="monotone" dataKey="sales" stroke="var(--c1)" strokeWidth={2.5} fill="url(#trendFill)" activeDot={{ r: 5, fill: "#fdc400", stroke: "var(--c1)", strokeWidth: 2 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function DonutChart({ data, money, centre, colors = CHART_COLORS, centreLabel = "Total", empty = "Nothing sold in this period yet", legend = true }: { data: { name: string; value: number }[]; money: Money; centre: string; colors?: string[]; centreLabel?: string; empty?: string; legend?: boolean }) {
  if (data.length === 0) return <Empty text={empty} />;
  const total = data.reduce((t, d) => t + d.value, 0) || 1;
  return (
    <div className="flex h-full w-full flex-col">
      <div className="relative min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="88%" paddingAngle={2} stroke="none">
              {data.map((_, i) => (
                <Cell key={i} fill={colors[i % colors.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(v) => fmt(Number(v), money)} contentStyle={{ borderRadius: 10, border: "1px solid var(--chart-grid)", background: "var(--card)", color: "var(--chart-label)" }} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center leading-tight">
          {(() => {
            // the number sits inside the ring on its own line, small enough to fit: "TSh 2,802,000" becomes "Total · TSh" over "2,802,000"
            const m = centre.match(/^(\D*?)\s*([\d][\d.,]*)\s*(.*)$/);
            const prefix = m?.[1]?.trim() ?? "";
            const num = m?.[2] ?? centre;
            const suffix = m?.[3]?.trim() ?? "";
            return (
              <>
                <span className="text-[10px] uppercase tracking-wide text-slate-500">{prefix ? `${centreLabel} · ${prefix}` : centreLabel}</span>
                <span className={num.length > 9 ? "text-[13px] font-semibold tabular-nums text-slate-900" : "text-base font-semibold tabular-nums text-slate-900"}>{num}</span>
                {suffix && <span className="text-[10px] text-slate-500">{suffix}</span>}
              </>
            );
          })()}
        </div>
      </div>
      {legend && (
        <ul className="mt-3 space-y-1 text-xs">
          {data.map((d, i) => (
            <li key={d.name} className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colors[i % colors.length] }} />
                <span className="truncate text-slate-700">{d.name}</span>
              </span>
              <span className="shrink-0 tabular-nums text-slate-500">
                {money.symbol ? `${fmt(d.value, money)} · ` : ""}
                {Math.round((d.value / total) * 100)}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TopProductsChart({ data, money, empty = "No product sales in this period yet", label = "Sales" }: { data: { name: string; value: number }[]; money: Money; empty?: string; label?: string }) {
  if (data.length === 0) return <Empty text={empty} />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 4" stroke="var(--chart-grid)" horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--chart-text)" }} tickFormatter={short} />
        <YAxis type="category" dataKey="name" width={112} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--chart-label)" }} tickFormatter={(v: string) => (v.length > 17 ? `${v.slice(0, 16)}…` : v)} />
        <Tooltip cursor={{ fill: "var(--color-slate-100)" }} formatter={(v) => [fmt(Number(v), money), label]} contentStyle={{ borderRadius: 10, border: "1px solid var(--chart-grid)", background: "var(--card)", color: "var(--chart-label)" }} />
        <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={16}>
          {data.map((_, i) => (
            <Cell key={i} fill={i === 0 ? "var(--c1)" : "var(--c4)"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Money received each day, stacked by how it was paid. */
export function MoneyBarsChart({ data, money }: { data: { label: string; cash: number; mobile: number; bank: number }[]; money: Money }) {
  if (data.every((d) => d.cash + d.mobile + d.bank === 0)) return <Empty text="No money received in this period yet" />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 4" stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--chart-text)" }} interval="preserveStartEnd" />
        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--chart-text)" }} tickFormatter={short} width={40} />
        <Tooltip cursor={{ fill: "var(--color-slate-100)" }} formatter={(v, name) => [fmt(Number(v), money), String(name)]} contentStyle={{ borderRadius: 10, border: "1px solid var(--chart-grid)", background: "var(--card)", color: "var(--chart-label)" }} />
        <Bar dataKey="cash" name="Cash" stackId="m" fill="var(--c1)" />
        <Bar dataKey="mobile" name="Mobile money" stackId="m" fill="var(--c3)" />
        <Bar dataKey="bank" name="Bank" stackId="m" fill="var(--c4)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Plain vertical bars (sales by weekday); the strongest bar is shown in oil yellow. */
export function ColumnsChart({ data, money, label = "Sales", empty = "No sales in this period yet" }: { data: { name: string; value: number }[]; money: Money; label?: string; empty?: string }) {
  if (data.every((d) => d.value === 0)) return <Empty text={empty} />;
  const max = Math.max(...data.map((d) => d.value));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 4" stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--chart-text)" }} />
        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--chart-text)" }} tickFormatter={short} width={40} />
        <Tooltip cursor={{ fill: "var(--color-slate-100)" }} formatter={(v) => [fmt(Number(v), money), label]} contentStyle={{ borderRadius: 10, border: "1px solid var(--chart-grid)", background: "var(--card)", color: "var(--chart-label)" }} />
        <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={36}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.value === max ? "var(--c3)" : "var(--c4)"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Twelve months of sales, costs and what was left, as smooth areas. */
export function YearChart({ data, money, showCosts = true }: { data: { label: string; sales: number; costs: number; left: number }[]; money: Money; showCosts?: boolean }) {
  if (data.every((d) => d.sales === 0 && d.costs === 0)) return <Empty text="Nothing recorded in the last twelve months yet" />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          {[["ySales", "var(--c1)"], ["yCosts", "var(--c2)"], ["yLeft", "var(--c5)"]].map(([id, col]) => (
            <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={col} stopOpacity={0.3} />
              <stop offset="100%" stopColor={col} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 4" stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--chart-text)" }} interval="preserveStartEnd" />
        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--chart-text)" }} tickFormatter={short} width={44} />
        <Tooltip formatter={(v, name) => [fmt(Number(v), money), String(name)]} contentStyle={{ borderRadius: 10, border: "1px solid var(--chart-grid)", background: "var(--card)", color: "var(--chart-label)" }} />
        <Area type="monotone" dataKey="sales" name="Sales" stroke="var(--c1)" strokeWidth={2.4} fill="url(#ySales)" />
        {showCosts && <Area type="monotone" dataKey="costs" name="Costs" stroke="var(--c2)" strokeWidth={2} fill="url(#yCosts)" />}
        {showCosts && <Area type="monotone" dataKey="left" name="What was left" stroke="var(--c5)" strokeWidth={2} fill="url(#yLeft)" />}
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Money coming in against money going out, month by month. */
export function InOutChart({ data, money, inLabel = "Money in", outLabel = "Money out", empty = "No money has moved yet" }: { data: { label: string; in: number; out: number }[]; money: Money; inLabel?: string; outLabel?: string; empty?: string }) {
  if (data.every((d) => d.in === 0 && d.out === 0)) return <Empty text={empty} />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2}>
        <CartesianGrid strokeDasharray="3 4" stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "var(--chart-text)" }} interval="preserveStartEnd" minTickGap={14} />
        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--chart-text)" }} tickFormatter={short} width={40} />
        <Tooltip cursor={{ fill: "var(--color-slate-100)" }} formatter={(v, name) => [fmt(Number(v), money), String(name)]} contentStyle={{ borderRadius: 10, border: "1px solid var(--chart-grid)", background: "var(--card)", color: "var(--chart-label)" }} />
        <Bar dataKey="in" name={inLabel} fill="var(--c5)" radius={[3, 3, 0, 0]} maxBarSize={14} />
        <Bar dataKey="out" name={outLabel} fill="var(--c2)" radius={[3, 3, 0, 0]} maxBarSize={14} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Sales of each closed day as bars; a day when the cash was short is red. */
export function ClosedDaysChart({ data, money }: { data: { label: string; value: number; short: boolean }[]; money: Money }) {
  if (data.length === 0 || data.every((d) => d.value === 0)) return <Empty text="No sales in these days" />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 4" stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--chart-text)" }} interval="preserveStartEnd" minTickGap={16} />
        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--chart-text)" }} tickFormatter={short} width={40} />
        <Tooltip cursor={{ fill: "var(--color-slate-100)" }} formatter={(v) => [fmt(Number(v), money), "Sold"]} contentStyle={{ borderRadius: 10, border: "1px solid var(--chart-grid)", background: "var(--card)", color: "var(--chart-label)" }} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={22}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.short ? "var(--c2)" : "var(--c1)"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** How far the counted cash was from what was expected, day by day: short in red, extra in oil yellow. */
export function DifferenceChart({ data, money }: { data: { label: string; value: number }[]; money: Money }) {
  if (data.length === 0) return <Empty text="No closed days yet" />;
  if (data.every((d) => d.value === 0)) return <Empty text="Every day matched. No cash was short or extra." />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 4" stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--chart-text)" }} interval="preserveStartEnd" minTickGap={16} />
        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--chart-text)" }} tickFormatter={short} width={40} />
        <Tooltip cursor={{ fill: "var(--color-slate-100)" }} formatter={(v) => [`${Number(v) < 0 ? "Short" : Number(v) > 0 ? "Extra" : "Spot on"} ${fmt(Math.abs(Number(v)), money)}`, "Cash"]} contentStyle={{ borderRadius: 10, border: "1px solid var(--chart-grid)", background: "var(--card)", color: "var(--chart-label)" }} />
        <Bar dataKey="value" radius={[4, 4, 4, 4]} maxBarSize={22}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.value < 0 ? "var(--c2)" : d.value > 0 ? "var(--c3)" : "var(--c5)"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
