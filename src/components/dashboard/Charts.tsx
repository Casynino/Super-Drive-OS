"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Brand-led palette: navy, red, oil yellow, then supporting tones.
export const CHART_COLORS = ["#0e3d6e", "#ed1c24", "#fdc400", "#4f85b9", "#16a34a", "#8b5cf6", "#94a3b8"];

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
            <stop offset="0%" stopColor="#0e3d6e" stopOpacity={0.28} />
            <stop offset="100%" stopColor="#0e3d6e" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 4" stroke="#e2e7ee" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#64748b" }} interval="preserveStartEnd" />
        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#64748b" }} tickFormatter={short} width={44} />
        <Tooltip
          cursor={{ stroke: "#0e3d6e", strokeDasharray: 4 }}
          formatter={(v) => [fmt(Number(v), money), "Sales"]}
          labelFormatter={(l, p) => `${l} · ${p?.[0]?.payload?.count ?? 0} sale(s)`}
          contentStyle={{ borderRadius: 10, border: "1px solid #e2e7ee", boxShadow: "0 6px 20px rgba(15,27,45,.08)" }}
        />
        <Area type="monotone" dataKey="sales" stroke="#0e3d6e" strokeWidth={2.5} fill="url(#trendFill)" activeDot={{ r: 5, fill: "#fdc400", stroke: "#0e3d6e", strokeWidth: 2 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function DonutChart({ data, money, centre }: { data: { name: string; value: number }[]; money: Money; centre: string }) {
  if (data.length === 0) return <Empty text="Nothing sold in this period yet" />;
  return (
    <div className="relative h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="88%" paddingAngle={2} stroke="none">
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(v) => fmt(Number(v), money)} contentStyle={{ borderRadius: 10, border: "1px solid #e2e7ee" }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-xs text-slate-500">Total</span>
        <span className="text-base font-semibold text-slate-900">{centre}</span>
      </div>
    </div>
  );
}

export function TopProductsChart({ data, money }: { data: { name: string; value: number }[]; money: Money }) {
  if (data.length === 0) return <Empty text="No product sales in this period yet" />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 4" stroke="#e2e7ee" horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#64748b" }} tickFormatter={short} />
        <YAxis type="category" dataKey="name" width={132} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#334155" }} />
        <Tooltip cursor={{ fill: "#f1f5f9" }} formatter={(v) => [fmt(Number(v), money), "Sales"]} contentStyle={{ borderRadius: 10, border: "1px solid #e2e7ee" }} />
        <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={16}>
          {data.map((_, i) => (
            <Cell key={i} fill={i === 0 ? "#0e3d6e" : "#4f85b9"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
