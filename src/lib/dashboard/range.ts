// Date ranges for dashboards, in the business time zone (Africa/Dar_es_Salaam is UTC+3 all year).
export type RangeKey = "today" | "7d" | "30d" | "month";

export const RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "month", label: "This month" },
];

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const shift = (s: string, days: number) => {
  const d = new Date(`${s}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return ymd(d);
};
export const todayYmd = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(new Date());
const startOf = (s: string) => new Date(`${s}T00:00:00+03:00`);
const endOf = (s: string) => new Date(`${s}T23:59:59.999+03:00`);

export type DateRange = { key: RangeKey; label: string; fromYmd: string; toYmd: string; from: Date; to: Date; prevFrom: Date; prevTo: Date; days: string[] };

export function resolveRange(input?: string): DateRange {
  const key = (RANGES.find((r) => r.key === input)?.key ?? "7d") as RangeKey;
  const today = todayYmd();
  const fromYmd = key === "today" ? today : key === "7d" ? shift(today, -6) : key === "30d" ? shift(today, -29) : `${today.slice(0, 8)}01`;
  const count = Math.round((startOf(today).getTime() - startOf(fromYmd).getTime()) / 86400000) + 1;
  const prevToYmd = shift(fromYmd, -1);
  const prevFromYmd = shift(fromYmd, -count);
  const days = Array.from({ length: count }, (_, i) => shift(fromYmd, i));
  return { key, label: RANGES.find((r) => r.key === key)!.label, fromYmd, toYmd: today, from: startOf(fromYmd), to: endOf(today), prevFrom: startOf(prevFromYmd), prevTo: endOf(prevToYmd), days };
}
