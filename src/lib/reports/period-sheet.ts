// Builds the business report document (a week, a month or any dates) from the records: sales with their growth against the
// period before, products, money by account, expenses, customers, credit, the cash count and banking, stock to watch.
import { Prisma } from "@/generated/prisma/client";
import type { ReportSheetData, ReportSection } from "@/components/reports/ReportSheet";
import type { Table, Tile } from "@/components/reports/EndOfDaySheet";
import type { Db } from "@/lib/db";
import { businessDay } from "@/lib/cash/ledger";
import { getStockAlerts } from "@/lib/inventory/alerts";
import { formatMoney } from "@/lib/money";
import { largestPack, qtyText } from "@/lib/qty";
import { outstandingByCustomer } from "@/lib/sales/outstanding";
import { owedSql } from "@/lib/sales/owed";
import { getBusinessProfile, getCurrency } from "@/lib/settings";
import { getPeriodStats, getProductsSold, getSalesPerDay, shiftDay } from "./period";

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const TZ = `AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Dar_es_Salaam'`;

const isYmd = (s?: string) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)));
const dayText = (ymd: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`));
const stamp = (d: Date) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" }).format(d);
const daysIn = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
const pct = (now: Dec, before: Dec) => (before.gt(0) ? Math.round(now.minus(before).div(before).mul(100).toNumber()) : null);
const share = (v: Dec, total: Dec) => (total.gt(0) ? `${v.div(total).mul(100).toFixed(0)}%` : "—");

/** Clamps whatever came in the address to real days, never in the future, at most 366 days, from <= to. */
export function cleanRange(from?: string, to?: string, today = businessDay()) {
  let t = isYmd(to) ? to! : today;
  if (t > today) t = today;
  let f = isYmd(from) ? from! : shiftDay(t, -6);
  if (f > t) f = t;
  if (daysIn(f, t) > 366) f = shiftDay(t, -365);
  return { from: f, to: t };
}

export async function loadPeriodSheet(db: Db, locationId: string, o: { from: string; to: string; seeProfit: boolean; preparedBy: string; preparedRole: string; logoSrc: string }) {
  const { from, to } = o;
  const days = daysIn(from, to);
  const prevTo = shiftDay(from, -1);
  const prevFrom = shiftDay(from, -days);
  const [currency, profile] = await Promise.all([getCurrency(), getBusinessProfile()]);
  const money = (v: Dec | string | number) => formatMoney(v, currency);

  const [cur, prev, products, perDay, alerts, customersTop, owedMap, balances, overdueRow, owner] = await Promise.all([
    getPeriodStats(db, locationId, from, to),
    getPeriodStats(db, locationId, prevFrom, prevTo),
    getProductsSold(db, locationId, from, to),
    getSalesPerDay(db, locationId, from, to),
    getStockAlerts(db),
    db.$queryRaw<{ id: string; name: string; n: bigint; v: Dec | null }[]>`
      SELECT c."id", c."name", COUNT(*) AS n, SUM(s."total" - s."returnedTotal") AS v
        FROM "Sale" s JOIN "Customer" c ON c."id" = s."customerId"
       WHERE s."status" = 'COMPLETED' AND s."locationId" = ${locationId} AND (s."createdAt" ${Prisma.raw(TZ)})::date BETWEEN ${from}::date AND ${to}::date
       GROUP BY c."id", c."name" ORDER BY v DESC LIMIT 8`,
    outstandingByCustomer(db),
    db.$queryRaw<{ name: string; method: string; bal: Dec | null }[]>`
      SELECT a."name", a."method"::text AS method, COALESCE(SUM(t."amount") FILTER (WHERE t."businessDate" <= ${to}::date), 0) AS bal
        FROM "CashAccount" a LEFT JOIN "CashTransaction" t ON t."accountId" = a."id"
       WHERE a."locationId" = ${locationId} AND a."status" = 'ACTIVE' GROUP BY a."id" ORDER BY a."method", a."name"`,
    db.$queryRaw<{ v: Dec | null }[]>`SELECT SUM(${owedSql()}) AS v FROM "Sale" WHERE "status" = 'COMPLETED' AND "dueDate" < ${businessDay()}::date AND ${owedSql()} > 0`,
    db.user.findFirst({ where: { status: "ACTIVE", role: { isSuperAdmin: true } }, orderBy: { createdAt: "asc" }, select: { name: true } }),
  ]);
  const packs = products.length ? await db.product.findMany({ where: { id: { in: products.map((p) => p.id) } }, select: { id: true, baseUnit: { select: { symbol: true } }, units: { select: { factor: true, unit: { select: { symbol: true } } } } } }) : [];

  const spent = cur.expensesByCategory.reduce((t, e) => t.plus(e.value), new D(0));
  const prevSpent = prev.expensesByCategory.reduce((t, e) => t.plus(e.value), new D(0));
  const profit = o.seeProfit ? { gross: cur.profit.gross, net: cur.profit.gross.minus(spent) } : null;
  const prevNet = prev.profit.gross.minus(prevSpent);
  const marginPct = profit && cur.profit.sales.gt(0) ? profit.net.div(cur.profit.sales).mul(100).toNumber() : 0;

  // title: a week (Monday to Sunday), a month, or any other dates
  const dow = new Date(`${from}T12:00:00Z`).getUTCDay();
  const isWeek = days === 7 && dow === 1;
  const isMonth = from.endsWith("-01") && shiftDay(to, 1).endsWith("-01") && from.slice(0, 7) === to.slice(0, 7);
  const title = isWeek ? "Weekly report" : isMonth ? "Monthly report" : "Business report";

  const strip: Tile[] = [
    { label: "Sold", value: money(cur.sales.total), note: `${cur.sales.count} sale${cur.sales.count === 1 ? "" : "s"}`, change: pct(cur.sales.total, prev.sales.total) },
    { label: "Money received", value: money(cur.money.income), note: `${cur.money.payments} payment${cur.money.payments === 1 ? "" : "s"}`, change: pct(cur.money.income, prev.money.income) },
    { label: "Expenses", value: money(spent), note: `${cur.expensesByCategory.length} categor${cur.expensesByCategory.length === 1 ? "y" : "ies"}` },
    profit
      ? { label: profit.net.lt(0) ? "Loss" : "Profit", value: money(profit.net.abs()), note: `${marginPct.toFixed(1)}% of sales`, tone: profit.net.lt(0) ? "red" : "green", change: profit.net.gt(0) ? pct(profit.net, prevNet) : null }
      : { label: "On credit", value: money(cur.sales.creditGiven), note: "not paid yet" },
    { label: "Cash short", value: cur.closings.short.isZero() ? "OK" : `− ${money(cur.closings.short)}`, note: `${cur.closings.count} of ${days} days closed`, tone: cur.closings.short.isZero() ? "green" : "red" },
    { label: "Banked", value: money(cur.banked), note: "taken to the bank" },
  ];

  // products
  const totalRev = products.reduce((t, p) => t.plus(p.revenue), new D(0));
  const totalProfit = products.reduce((t, p) => t.plus(p.revenue.minus(p.cost)), new D(0));
  const shown = products.slice(0, 15);
  const productsTable: Table = {
    columns: [{ label: "Product" }, { label: "Sold", right: true }, { label: "Revenue", right: true }, { label: "Share", right: true }, ...(profit ? [{ label: "Profit", right: true }] : [])],
    rows: shown.map((p) => {
      const meta = packs.find((x) => x.id === p.id);
      const sold = meta ? qtyText(Number(p.qty), largestPack(meta.units.map((u) => ({ symbol: u.unit.symbol, factor: u.factor }))), meta.baseUnit.symbol).main : p.qty.toString();
      return [p.name, sold, money(p.revenue), share(p.revenue, totalRev), ...(profit ? [money(p.revenue.minus(p.cost))] : [])];
    }),
    total: products.length ? [products.length > shown.length ? `Total (${products.length} products)` : "Total", "", money(totalRev), "100%", ...(profit ? [money(totalProfit)] : [])] : undefined,
  };

  // sales over time: one bar per day, per week, or per month, depending on how long the period is
  const byDay = new Map(perDay.map((d) => [d.day, d.total]));
  const buckets: { label: string; total: Dec }[] = [];
  if (days <= 31) {
    for (let i = 0; i < days; i++) {
      const d = shiftDay(from, i);
      buckets.push({ label: d.slice(8), total: byDay.get(d) ?? new D(0) });
    }
  } else if (days <= 120) {
    for (let i = 0; i < days; i += 7) {
      let t = new D(0);
      for (let k = i; k < Math.min(i + 7, days); k++) t = t.plus(byDay.get(shiftDay(from, k)) ?? 0);
      buckets.push({ label: dayText(shiftDay(from, i)).slice(0, -5), total: t });
    }
  } else {
    const m = new Map<string, Dec>();
    for (let i = 0; i < days; i++) {
      const d = shiftDay(from, i);
      m.set(d.slice(0, 7), (m.get(d.slice(0, 7)) ?? new D(0)).plus(byDay.get(d) ?? 0));
    }
    for (const [k, v] of m) buckets.push({ label: new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(new Date(`${k}-15T12:00:00Z`)), total: v });
  }
  const peak = buckets.reduce((m, b) => (b.total.gt(m) ? b.total : m), new D(0));
  const trading = perDay.filter((d) => d.total.gt(0));
  const best = trading.reduce<{ day: string; total: Dec } | null>((m, d) => (!m || d.total.gt(m.total) ? d : m), null);
  const quiet = trading.reduce<{ day: string; total: Dec } | null>((m, d) => (!m || d.total.lt(m.total) ? d : m), null);
  const sales: ReportSection = {
    kind: "chart",
    title: "Sales over time",
    sub: days <= 31 ? "Each day, the best one in yellow" : days <= 120 ? "Each week, the best one in yellow" : "Each month, the best one in yellow",
    bars: buckets.map((b) => ({ label: b.label, pct: peak.gt(0) ? Math.max(b.total.div(peak).mul(100).toNumber(), b.total.gt(0) ? 3 : 0) : 0, highlight: peak.gt(0) && b.total.eq(peak) })),
    tiles: [
      { label: "Best day", value: best ? money(best.total) : "—", note: best ? dayText(best.day) : "No sales" },
      { label: "Quietest trading day", value: quiet ? money(quiet.total) : "—", note: quiet ? dayText(quiet.day) : "No sales" },
      { label: "Average per day", value: money(cur.sales.total.div(days)), note: `over ${days} day${days === 1 ? "" : "s"}` },
      { label: "Against the period before", value: money(prev.sales.total), note: pct(cur.sales.total, prev.sales.total) === null ? "Nothing to compare with" : `${pct(cur.sales.total, prev.sales.total)! >= 0 ? "Up" : "Down"} ${Math.abs(pct(cur.sales.total, prev.sales.total)!)}% now`, change: pct(cur.sales.total, prev.sales.total) },
    ],
  };

  const inAccounts = cur.money.byAccount.filter((a) => a.income.gt(0));
  const inTotal = inAccounts.reduce((t, a) => t.plus(a.income), new D(0));
  const prevByName = new Map(prev.expensesByCategory.map((e) => [e.name, e.value]));
  const expenseChange = (name: string, v: Dec) => {
    const p = pct(v, prevByName.get(name) ?? new D(0));
    return p === null ? "new" : p === 0 ? "same" : `${p > 0 ? "+" : "−"}${Math.abs(p)}%`;
  };

  const owedNow = [...owedMap.values()].reduce((t, v) => t.plus(v), new D(0));
  const overdue = new D(overdueRow[0]?.v ?? 0);
  const endTotal = balances.reduce((t, b) => t.plus(b.bal ?? 0), new D(0));

  const sections: ReportSection[] = [
    { kind: "table", title: "What was sold", sub: "Each product, after returns", table: productsTable, empty: "Nothing was sold." },
    sales,
    { kind: "table", title: "Where the money came in", sub: "By account, paid at the sale and on debts", table: { columns: [{ label: "Account" }, { label: "Amount", right: true }, { label: "Share", right: true }], rows: inAccounts.map((a) => [a.name, money(a.income), share(a.income, inTotal)]), total: inAccounts.length ? ["Total", money(inTotal), "100%"] : undefined }, empty: "No money came in." },
    { kind: "table", title: "Expenses", sub: "What the shop spent, against the period before", table: { columns: [{ label: "Category" }, { label: "Amount", right: true }, { label: "Before", right: true }, { label: "Change", right: true }], rows: cur.expensesByCategory.map((e) => [e.name, money(e.value), money(prevByName.get(e.name) ?? 0), expenseChange(e.name, e.value)]), total: cur.expensesByCategory.length ? ["Total", money(spent), money(prevSpent), pct(spent, prevSpent) === null ? "—" : pct(spent, prevSpent) === 0 ? "same" : `${pct(spent, prevSpent)! > 0 ? "+" : "−"}${Math.abs(pct(spent, prevSpent)!)}%`] : undefined }, empty: "Nothing was spent." },
    { kind: "table", title: "Customers", sub: "Who bought most, and what they owe now", table: { columns: [{ label: "Customer" }, { label: "Orders", right: true }, { label: "Bought", right: true }, { label: "Owes now", right: true }], rows: customersTop.map((c) => [c.name, String(Number(c.n)), money(c.v ?? 0), owedMap.get(c.id)?.gt(0) ? money(owedMap.get(c.id)!) : "—"]) }, empty: "No sales to named customers." },
    { kind: "tiles", title: "Credit and the cash count", sub: "Debts today, and how the days closed", cols: 4, tiles: [
      { label: "Owed by customers", value: money(owedNow), note: "now" },
      { label: "Past the due date", value: money(overdue), note: "now", tone: overdue.gt(0) ? "red" : "plain" },
      { label: "Days closed", value: `${cur.closings.count} of ${days}`, note: cur.closings.count < days ? "some days have no closing" : "every day closed" },
      { label: "Cash short", value: cur.closings.short.isZero() ? "OK" : `− ${money(cur.closings.short)}`, tone: cur.closings.short.gt(0) ? "red" : "green", note: cur.closings.extra.gt(0) ? `and + ${money(cur.closings.extra)} extra` : "over the closed days" },
    ] },
    { kind: "tiles", title: "Where the money was at the end", sub: `On ${dayText(to)}`, cols: Math.min(4, Math.max(2, balances.length + 1)), tiles: [...balances.map((b): Tile => ({ label: b.name, value: money(b.bal ?? 0), note: b.method === "CASH" ? "the till" : b.method === "BANK" ? "bank account" : "mobile money" })), { label: "All together", value: money(endTotal), tone: "green" }] },
    { kind: "table", title: "Stock to watch", sub: "Products that are out or below their minimum", table: { columns: [{ label: "Product" }, { label: "In stock", right: true }, { label: "Status" }], rows: [...alerts.out.map((a) => [a.name, "0", "Out of stock"]), ...alerts.low.map((a) => [a.name, qtyText(Number(a.qty), a.pack, a.symbol).main, "Low"])].slice(0, 14) }, empty: "Every product is above its minimum." },
  ];

  const data: ReportSheetData = {
    title,
    intro: "Sales and growth, products, money in, expenses, customers and cash.",
    number: `RPT-${from.replaceAll("-", "")}-${to.replaceAll("-", "")}`,
    preparedAt: stamp(new Date()),
    rangeText: from === to ? dayText(from) : `${dayText(from)} to ${dayText(to)}`,
    business: { name: profile.name, address: profile.address, phone: profile.phone },
    logoSrc: o.logoSrc,
    currencyCode: currency.code,
    strip,
    sections,
    signatures: { preparedBy: o.preparedBy, preparedRole: o.preparedRole, approvedBy: owner?.name ?? "Owner" },
  };
  return { data, title };
}
