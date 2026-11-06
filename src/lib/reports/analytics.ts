// Business analytics for the owner. Every figure comes from real records; anything that is a projection is flagged
// `estimate: true` so the screen can label it. Sales are "net": after returns. Money is returned as plain numbers
// (Decimal columns are summed in SQL), which is safe for display and charts.
import type { Prisma } from "@/generated/prisma/client";
import { Prisma as P } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";
import { owedSql } from "@/lib/sales/owed";
import { todayYmd } from "@/lib/dashboard/range";

const n = (v: unknown) => Number(v ?? 0);
const LOCAL = P.raw(`AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Dar_es_Salaam'`);
const day = (col: string) => P.raw(`("${col}" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Dar_es_Salaam')::date`);

export type Grain = "day" | "week" | "month";
export type ReportRange = { fromYmd: string; toYmd: string; prevFromYmd: string; prevToYmd: string; from: Date; to: Date; prevFrom: Date; prevTo: Date; label: string; days: number };

const shift = (s: string, d: number) => {
  const x = new Date(`${s}T00:00:00.000Z`);
  x.setUTCDate(x.getUTCDate() + d);
  return x.toISOString().slice(0, 10);
};
const isYmd = (s?: string) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)));
const start = (s: string) => new Date(`${s}T00:00:00+03:00`);
const end = (s: string) => new Date(`${s}T23:59:59.999+03:00`);

export const PRESETS = [
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "month", label: "This month" },
  { key: "90d", label: "Last 90 days" },
  { key: "year", label: "This year" },
] as const;

/** A preset ("30d") or a custom from/to (YYYY-MM-DD); the previous period is the same length right before it. */
export function reportRange(sp: { range?: string; from?: string; to?: string }): ReportRange {
  const today = todayYmd();
  let from: string;
  let to = today;
  let label: string;
  if (isYmd(sp.from) && isYmd(sp.to) && sp.from! <= sp.to!) {
    from = sp.from!;
    to = sp.to! > today ? today : sp.to!;
    label = `${from} to ${to}`;
  } else {
    const key = PRESETS.find((p) => p.key === sp.range)?.key ?? "30d";
    from = key === "7d" ? shift(today, -6) : key === "30d" ? shift(today, -29) : key === "90d" ? shift(today, -89) : key === "month" ? `${today.slice(0, 8)}01` : `${today.slice(0, 4)}-01-01`;
    label = PRESETS.find((p) => p.key === key)!.label;
  }
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  return { fromYmd: from, toYmd: to, prevFromYmd: shift(from, -days), prevToYmd: shift(from, -1), from: start(from), to: end(to), prevFrom: start(shift(from, -days)), prevTo: end(shift(from, -1)), label, days };
}

// ───────────── Sales ─────────────

export async function salesAnalytics(db: Db, r: ReportRange, grain: Grain, financials: boolean) {
  const trunc = P.raw(grain === "day" ? "'day'" : grain === "week" ? "'week'" : "'month'"); // a fixed literal: grain is one of three known values
  const [tot, prevTot, series, byProduct, byCategory, byEmployee, byWeekday, restored] = await Promise.all([
    db.$queryRaw<{ sales: P.Decimal | null; n: bigint; cogs: P.Decimal | null; credit: P.Decimal | null }[]>`
      SELECT SUM(s."total" - s."returnedTotal") AS sales, COUNT(*) AS n, SUM(s."cogsTotal") AS cogs,
             SUM(GREATEST(s."total" - COALESCE(a.paid, 0), 0)) AS credit
        FROM "Sale" s
        LEFT JOIN (SELECT pa."saleId", SUM(pa."amount") AS paid FROM "PaymentAllocation" pa JOIN "Payment" p ON p."id" = pa."paymentId" WHERE p."source" = 'AT_SALE' GROUP BY 1) a ON a."saleId" = s."id"
       WHERE s."status" = 'COMPLETED' AND s."createdAt" >= ${r.from} AND s."createdAt" <= ${r.to}`,
    db.$queryRaw<{ sales: P.Decimal | null; n: bigint }[]>`
      SELECT SUM("total" - "returnedTotal") AS sales, COUNT(*) AS n FROM "Sale" WHERE "status" = 'COMPLETED' AND "createdAt" >= ${r.prevFrom} AND "createdAt" <= ${r.prevTo}`,
    db.$queryRaw<{ d: Date; sales: P.Decimal | null; n: bigint }[]>`
      SELECT date_trunc(${trunc}, ${day("createdAt")})::date AS d, SUM("total" - "returnedTotal") AS sales, COUNT(*) AS n
        FROM "Sale" WHERE "status" = 'COMPLETED' AND "createdAt" >= ${r.from} AND "createdAt" <= ${r.to} GROUP BY 1 ORDER BY 1`,
    db.$queryRaw<{ id: string; name: string; qty: P.Decimal | null; revenue: P.Decimal | null; cost: P.Decimal | null }[]>`
      SELECT p."id", p."name", SUM(si."quantity" - COALESCE(x.q, 0)) AS qty, SUM(si."lineTotal" - COALESCE(x.v, 0)) AS revenue,
             SUM(si."costTotal" - COALESCE(x.c, 0)) AS cost
        FROM "SaleItem" si JOIN "Sale" s ON s."id" = si."saleId" JOIN "Product" p ON p."id" = si."productId"
        LEFT JOIN (SELECT ri."saleItemId", SUM(ri."quantity") AS q, SUM(ri."returnValue") AS v, SUM(ri."costValue") AS c FROM "ReversalItem" ri JOIN "SaleReversal" rv ON rv."id" = ri."reversalId" WHERE rv."status" = 'COMPLETED' GROUP BY 1) x ON x."saleItemId" = si."id"
       WHERE s."status" = 'COMPLETED' AND s."createdAt" >= ${r.from} AND s."createdAt" <= ${r.to}
       GROUP BY p."id", p."name" ORDER BY revenue DESC LIMIT 20`,
    db.$queryRaw<{ name: string; revenue: P.Decimal | null }[]>`
      SELECT c."name", SUM(si."lineTotal" - COALESCE(x.v, 0)) AS revenue
        FROM "SaleItem" si JOIN "Sale" s ON s."id" = si."saleId" JOIN "Product" p ON p."id" = si."productId" JOIN "Category" c ON c."id" = p."categoryId"
        LEFT JOIN (SELECT ri."saleItemId", SUM(ri."returnValue") AS v FROM "ReversalItem" ri JOIN "SaleReversal" rv ON rv."id" = ri."reversalId" WHERE rv."status" = 'COMPLETED' GROUP BY 1) x ON x."saleItemId" = si."id"
       WHERE s."status" = 'COMPLETED' AND s."createdAt" >= ${r.from} AND s."createdAt" <= ${r.to} GROUP BY c."name" ORDER BY revenue DESC`,
    db.$queryRaw<{ name: string; sales: P.Decimal | null; n: bigint }[]>`
      SELECT u."name", SUM(s."total" - s."returnedTotal") AS sales, COUNT(*) AS n FROM "Sale" s JOIN "User" u ON u."id" = s."salespersonId"
       WHERE s."status" = 'COMPLETED' AND s."createdAt" >= ${r.from} AND s."createdAt" <= ${r.to} GROUP BY u."name" ORDER BY sales DESC`,
    db.$queryRaw<{ dow: number; sales: P.Decimal | null }[]>`
      SELECT EXTRACT(DOW FROM ${day("createdAt")})::int AS dow, SUM("total" - "returnedTotal") AS sales
        FROM "Sale" WHERE "status" = 'COMPLETED' AND "createdAt" >= ${r.from} AND "createdAt" <= ${r.to} GROUP BY 1`,
    db.$queryRaw<{ v: P.Decimal | null }[]>`
      SELECT SUM(ri."costValue") AS v FROM "ReversalItem" ri JOIN "SaleReversal" rv ON rv."id" = ri."reversalId" JOIN "Sale" s ON s."id" = rv."saleId"
       WHERE rv."status" = 'COMPLETED' AND s."status" = 'COMPLETED' AND s."createdAt" >= ${r.from} AND s."createdAt" <= ${r.to}`,
  ]);
  const sales = n(tot[0]?.sales);
  const count = Number(tot[0]?.n ?? 0);
  const cogs = n(tot[0]?.cogs) - n(restored[0]?.v);
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const weekday = names.map((name, i) => ({ name, value: n(byWeekday.find((w) => w.dow === i)?.sales) }));
  return {
    totals: { sales, count, avg: count ? sales / count : 0, prevSales: n(prevTot[0]?.sales), prevCount: Number(prevTot[0]?.n ?? 0), creditGiven: n(tot[0]?.credit), cogs: financials ? cogs : null, profit: financials ? sales - cogs : null },
    series: series.map((s) => ({ label: grain === "month" ? s.d.toISOString().slice(0, 7) : s.d.toISOString().slice(5, 10).split("-").reverse().join("/"), sales: n(s.sales), count: Number(s.n) })),
    byProduct: byProduct.map((p) => ({ id: p.id, name: p.name, qty: n(p.qty), revenue: n(p.revenue), profit: financials ? n(p.revenue) - n(p.cost) : null })),
    byCategory: byCategory.map((c) => ({ name: c.name, value: n(c.revenue) })).filter((c) => c.value > 0),
    byEmployee: byEmployee.map((e) => ({ name: e.name, sales: n(e.sales), count: Number(e.n) })),
    weekday,
  };
}

// ───────────── Inventory ─────────────

export type StockRow = {
  id: string; name: string; sku: string; symbol: string; shelf: number; withResellers: number; value: number | null;
  sold30: number; lastSale: Date | null; lastReceived: Date | null; stockouts90: number; cover: number | null; minStock: number;
};

export async function inventoryAnalytics(db: Db, valuation: boolean) {
  const rows = await db.$queryRaw<{
    id: string; name: string; sku: string; symbol: string; minStock: P.Decimal; avgCost: P.Decimal; shelf: P.Decimal | null; away: P.Decimal | null;
    sold30: P.Decimal | null; lastSale: Date | null; lastReceived: Date | null; stockouts: bigint;
  }[]>`
    SELECT p."id", p."name", p."sku", u."symbol", p."minStock", p."avgCost",
      (SELECT SUM(b."quantity") FROM "StockBalance" b JOIN "Location" l ON l."id" = b."locationId" WHERE b."productId" = p."id" AND l."type" <> 'RESELLER') AS shelf,
      (SELECT SUM(b."quantity") FROM "StockBalance" b JOIN "Location" l ON l."id" = b."locationId" WHERE b."productId" = p."id" AND l."type" = 'RESELLER') AS away,
      (SELECT SUM(si."quantity") FROM "SaleItem" si JOIN "Sale" s ON s."id" = si."saleId" WHERE si."productId" = p."id" AND s."status" = 'COMPLETED' AND s."createdAt" >= now() - interval '30 days') AS sold30,
      (SELECT MAX(s."createdAt") FROM "SaleItem" si JOIN "Sale" s ON s."id" = si."saleId" WHERE si."productId" = p."id" AND s."status" = 'COMPLETED') AS "lastSale",
      (SELECT MAX(m."createdAt") FROM "StockMovement" m WHERE m."productId" = p."id" AND m."type" = 'RECEIVED') AS "lastReceived",
      (SELECT COUNT(*) FROM "StockMovement" m WHERE m."productId" = p."id" AND m."type" = 'SOLD' AND m."newQty" <= 0 AND m."createdAt" >= now() - interval '90 days') AS stockouts
      FROM "Product" p JOIN "Unit" u ON u."id" = p."baseUnitId" WHERE p."status" = 'ACTIVE' ORDER BY p."name"`;
  const list: StockRow[] = rows.map((r) => {
    const shelf = n(r.shelf);
    const away = n(r.away);
    const sold30 = n(r.sold30);
    return {
      id: r.id, name: r.name, sku: r.sku, symbol: r.symbol, shelf, withResellers: away, value: valuation ? (shelf + away) * n(r.avgCost) : null, sold30, lastSale: r.lastSale, lastReceived: r.lastReceived,
      stockouts90: Number(r.stockouts), cover: sold30 > 0 ? shelf / (sold30 / 30) : null, minStock: n(r.minStock),
    };
  });
  const now = Date.now();
  const age = (d: Date | null) => (d ? Math.floor((now - d.getTime()) / 86_400_000) : null);
  const holding = list.filter((p) => p.shelf + p.withResellers > 0);
  return {
    list,
    totalValue: valuation ? list.reduce((s, p) => s + (p.value ?? 0), 0) : null,
    shelfItems: list.reduce((s, p) => s + p.shelf, 0),
    resellerItems: list.reduce((s, p) => s + p.withResellers, 0),
    low: list.filter((p) => p.shelf > 0 && p.minStock > 0 && p.shelf <= p.minStock),
    out: list.filter((p) => p.shelf <= 0),
    fast: [...list].filter((p) => p.sold30 > 0).sort((a, b) => b.sold30 - a.sold30).slice(0, 8),
    slow: [...holding].filter((p) => p.shelf > 0).sort((a, b) => a.sold30 - b.sold30).slice(0, 8),
    dead: holding.filter((p) => p.shelf > 0 && (age(p.lastSale) === null || age(p.lastSale)! >= 60) && (age(p.lastReceived) === null || age(p.lastReceived)! >= 30)),
    frequentlyOut: [...list].filter((p) => p.stockouts90 >= 2).sort((a, b) => b.stockouts90 - a.stockouts90).slice(0, 8),
    age,
  };
}

// ───────────── Finance ─────────────

export async function financeAnalytics(db: Db, r: ReportRange) {
  const [expenses, prevExpenses, receivables, flow] = await Promise.all([
    db.$queryRaw<{ name: string; v: P.Decimal | null }[]>`
      SELECT c."name", SUM(e."amount") AS v FROM "Expense" e JOIN "ExpenseCategory" c ON c."id" = e."categoryId"
       WHERE e."status" = 'APPROVED' AND e."expenseDate" >= ${r.fromYmd}::date AND e."expenseDate" <= ${r.toYmd}::date GROUP BY c."name" ORDER BY v DESC`,
    db.$queryRaw<{ name: string; v: P.Decimal | null }[]>`
      SELECT c."name", SUM(e."amount") AS v FROM "Expense" e JOIN "ExpenseCategory" c ON c."id" = e."categoryId"
       WHERE e."status" = 'APPROVED' AND e."expenseDate" >= ${r.prevFromYmd}::date AND e."expenseDate" <= ${r.prevToYmd}::date GROUP BY c."name"`,
    db.$queryRaw<{ channel: string; owed: P.Decimal | null; overdue: P.Decimal | null }[]>`
      SELECT "channel"::text AS channel, SUM(${owedSql()}) AS owed, SUM(CASE WHEN "dueDate" < ${todayYmd()}::date THEN ${owedSql()} ELSE 0 END) AS overdue
        FROM "Sale" WHERE "status" = 'COMPLETED' AND ${owedSql()} > 0 GROUP BY 1`,
    db.$queryRaw<{ method: string; type: string; v: P.Decimal | null }[]>`
      SELECT a."method"::text AS method, t."type"::text AS type, SUM(t."amount") AS v
        FROM "CashTransaction" t JOIN "CashAccount" a ON a."id" = t."accountId"
       WHERE t."businessDate" >= ${r.fromYmd}::date AND t."businessDate" <= ${r.toYmd}::date GROUP BY 1, 2`,
  ]);
  const owed = (c: string) => n(receivables.find((x) => x.channel === c)?.owed);
  const over = (c: string) => n(receivables.find((x) => x.channel === c)?.overdue);
  const flowIn = flow.filter((f) => n(f.v) > 0).reduce((s, f) => s + n(f.v), 0);
  const flowOut = flow.filter((f) => n(f.v) < 0).reduce((s, f) => s - n(f.v), 0);
  return {
    expenses: expenses.map((e) => ({ name: e.name, value: n(e.v) })),
    prevExpenses: new Map(prevExpenses.map((e) => [e.name, n(e.v)])),
    expenseTotal: expenses.reduce((s, e) => s + n(e.v), 0),
    customerOwed: owed("SHOP"), customerOverdue: over("SHOP"), resellerOwed: owed("RESELLER"), resellerOverdue: over("RESELLER"),
    flow: flow.map((f) => ({ method: f.method, type: f.type, value: n(f.v) })),
    flowIn, flowOut,
  };
}

// ───────────── Insights (each one states whether it is an actual figure or an estimate) ─────────────

export type Insight = { tone: "good" | "warn" | "info"; text: string; estimate?: boolean };

export async function insights(db: Db, sales: Awaited<ReturnType<typeof salesAnalytics>>, inv: Awaited<ReturnType<typeof inventoryAnalytics>>, fin: Awaited<ReturnType<typeof financeAnalytics>>, r: ReportRange): Promise<Insight[]> {
  const out: Insight[] = [];
  const pct = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : null);
  const t = sales.totals;
  const salesChange = pct(t.sales, t.prevSales);
  if (salesChange !== null && Math.abs(salesChange) >= 5) out.push({ tone: salesChange > 0 ? "good" : "warn", text: `Sales are ${Math.abs(salesChange).toFixed(0)}% ${salesChange > 0 ? "higher" : "lower"} than the previous ${r.days} days.` });

  const best = [...sales.weekday].sort((a, b) => b.value - a.value)[0];
  if (best && best.value > 0) out.push({ tone: "info", text: `${best.name} is the strongest sales day in this period.` });

  // product demand change: this period vs the one before
  const prev = await db.$queryRaw<{ id: string; qty: P.Decimal | null }[]>`
    SELECT si."productId" AS id, SUM(si."quantity") AS qty FROM "SaleItem" si JOIN "Sale" s ON s."id" = si."saleId"
     WHERE s."status" = 'COMPLETED' AND s."createdAt" >= ${r.prevFrom} AND s."createdAt" <= ${r.prevTo} GROUP BY 1`;
  const prevQty = new Map(prev.map((p) => [p.id, n(p.qty)]));
  for (const p of sales.byProduct.slice(0, 6)) {
    const before = prevQty.get(p.id) ?? 0;
    const ch = pct(p.qty, before);
    if (ch !== null && ch >= 25 && before >= 3) out.push({ tone: "good", text: `${p.name} sold ${p.qty.toFixed(0)} units, ${ch.toFixed(0)}% more than in the previous ${r.days} days.` });
    if (ch !== null && ch <= -30 && before >= 5) out.push({ tone: "warn", text: `${p.name} sold ${Math.abs(ch).toFixed(0)}% fewer units than in the previous ${r.days} days.` });
  }

  for (const p of inv.list) {
    if (p.cover !== null && p.cover <= 7 && p.shelf > 0) out.push({ tone: "warn", estimate: true, text: `${p.name} may run out in about ${Math.max(1, Math.round(p.cover))} day${Math.round(p.cover) === 1 ? "" : "s"} if sales continue like the last 30 days (${p.shelf} ${p.symbol} on the shelf).` });
  }
  for (const p of inv.dead.slice(0, 4)) {
    const d = inv.age(p.lastSale);
    out.push({ tone: "warn", text: d === null ? `${p.name} has ${p.shelf} ${p.symbol} on the shelf and has never been sold.` : `${p.name} has not been sold for ${d} days (${p.shelf} ${p.symbol} on the shelf).` });
  }
  for (const [name, now] of fin.expenses.map((e) => [e.name, e.value] as const)) {
    const before = fin.prevExpenses.get(name) ?? 0;
    const ch = pct(now, before);
    if (ch !== null && ch >= 20 && before > 0) out.push({ tone: "warn", text: `${name} expenses went up ${ch.toFixed(0)}% compared with the previous ${r.days} days.` });
  }
  if (fin.resellerOverdue > 0) out.push({ tone: "warn", text: `Winga owe ${new Intl.NumberFormat("en-US").format(fin.resellerOverdue)} past the settlement date.` });
  if (fin.customerOverdue > 0) out.push({ tone: "warn", text: `Customers owe ${new Intl.NumberFormat("en-US").format(fin.customerOverdue)} past the due date.` });
  if (inv.frequentlyOut.length) out.push({ tone: "warn", text: `${inv.frequentlyOut.map((p) => p.name).slice(0, 3).join(", ")} ran out of stock more than once in the last 90 days.` });
  if (out.length === 0) out.push({ tone: "info", text: "Not enough activity in this period to draw conclusions yet." });
  return out;
}
