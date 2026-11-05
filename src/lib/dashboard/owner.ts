// Numbers for the owner / manager dashboard. Everything comes from real records, in one place, so every
// tile and chart can be traced back to transactions. Money is "net": after returns and refunds.
import { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";
import { owedSql } from "@/lib/sales/owed";
import { todayYmd, type DateRange } from "./range";

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const n = (v: Dec | string | number | bigint | null | undefined) => Number(v ?? 0);

export type OwnerData = Awaited<ReturnType<typeof getOwnerDashboard>>;

export async function getOwnerDashboard(db: Db, range: DateRange, opts: { financials: boolean; valuation: boolean }) {
  const { from, to, prevFrom, prevTo } = range;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(new Date());

  const totals = async (a: Date, b: Date) => {
    const [s, c] = await Promise.all([
      db.$queryRaw<{ sales: Dec | null; cogs: Dec | null; n: bigint }[]>`
        SELECT SUM("total" - "returnedTotal") AS sales, SUM("cogsTotal") AS cogs, COUNT(*) AS n
          FROM "Sale" WHERE "status" = 'COMPLETED' AND "createdAt" >= ${a} AND "createdAt" <= ${b}`,
      db.$queryRaw<{ restored: Dec | null }[]>`
        SELECT SUM(ri."costValue") AS restored
          FROM "ReversalItem" ri JOIN "SaleReversal" r ON r."id" = ri."reversalId" JOIN "Sale" s ON s."id" = r."saleId"
         WHERE r."status" = 'COMPLETED' AND s."status" = 'COMPLETED' AND s."createdAt" >= ${a} AND s."createdAt" <= ${b}`,
    ]);
    const sales = n(s[0]?.sales);
    const cogs = n(s[0]?.cogs) - n(c[0]?.restored);
    return { sales, count: Number(s[0]?.n ?? 0), profit: sales - cogs };
  };
  const cash = async (a: Date, b: Date) => {
    const [pay, refunds] = await Promise.all([
      db.payment.groupBy({ by: ["method"], where: { receivedAt: { gte: a, lte: b } }, _sum: { amount: true } }),
      db.saleReversal.groupBy({ by: ["refundMethod"], where: { status: "COMPLETED", decidedAt: { gte: a, lte: b }, refundAmount: { gt: 0 } }, _sum: { refundAmount: true } }),
    ]);
    const byMethod = { CASH: 0, MOBILE_MONEY: 0, BANK: 0 } as Record<string, number>;
    for (const p of pay) byMethod[p.method] = (byMethod[p.method] ?? 0) + n(p._sum.amount);
    for (const r of refunds) if (r.refundMethod) byMethod[r.refundMethod] = (byMethod[r.refundMethod] ?? 0) - n(r._sum.refundAmount);
    return { byMethod, total: Object.values(byMethod).reduce((s, v) => s + v, 0) };
  };

  const [cur, prev, curCash, prevCash, daily, byCategory, topProducts, staff, debt, stockValue, recent, pendingApprovals, debtors] = await Promise.all([
    totals(from, to),
    totals(prevFrom, prevTo),
    cash(from, to),
    cash(prevFrom, prevTo),
    db.$queryRaw<{ day: string; sales: Dec | null; n: bigint }[]>`
      SELECT to_char(("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Dar_es_Salaam')::date, 'YYYY-MM-DD') AS day,
             SUM("total" - "returnedTotal") AS sales, COUNT(*) AS n
        FROM "Sale" WHERE "status" = 'COMPLETED' AND "createdAt" >= ${from} AND "createdAt" <= ${to} GROUP BY 1 ORDER BY 1`,
    db.$queryRaw<{ name: string; value: Dec | null }[]>`
      SELECT c."name" AS name, SUM(si."lineTotal" - COALESCE(r.v, 0)) AS value
        FROM "SaleItem" si JOIN "Sale" s ON s."id" = si."saleId" JOIN "Product" p ON p."id" = si."productId" JOIN "Category" c ON c."id" = p."categoryId"
        LEFT JOIN (SELECT ri."saleItemId", SUM(ri."returnValue") AS v FROM "ReversalItem" ri JOIN "SaleReversal" rv ON rv."id" = ri."reversalId" WHERE rv."status" = 'COMPLETED' GROUP BY 1) r ON r."saleItemId" = si."id"
       WHERE s."status" = 'COMPLETED' AND s."createdAt" >= ${from} AND s."createdAt" <= ${to}
       GROUP BY c."name" ORDER BY value DESC`,
    db.$queryRaw<{ id: string; name: string; value: Dec | null; units: Dec | null }[]>`
      SELECT p."id", p."name", SUM(si."lineTotal" - COALESCE(r.v, 0)) AS value, SUM(si."quantity" - COALESCE(r.q, 0)) AS units
        FROM "SaleItem" si JOIN "Sale" s ON s."id" = si."saleId" JOIN "Product" p ON p."id" = si."productId"
        LEFT JOIN (SELECT ri."saleItemId", SUM(ri."returnValue") AS v, SUM(ri."quantity") AS q FROM "ReversalItem" ri JOIN "SaleReversal" rv ON rv."id" = ri."reversalId" WHERE rv."status" = 'COMPLETED' GROUP BY 1) r ON r."saleItemId" = si."id"
       WHERE s."status" = 'COMPLETED' AND s."createdAt" >= ${from} AND s."createdAt" <= ${to}
       GROUP BY p."id", p."name" ORDER BY value DESC LIMIT 6`,
    db.$queryRaw<{ id: string; name: string; sales: Dec | null; n: bigint }[]>`
      SELECT u."id", u."name", SUM(s."total" - s."returnedTotal") AS sales, COUNT(*) AS n
        FROM "Sale" s JOIN "User" u ON u."id" = s."salespersonId"
       WHERE s."status" = 'COMPLETED' AND s."createdAt" >= ${from} AND s."createdAt" <= ${to} GROUP BY u."id", u."name" ORDER BY sales DESC`,
    db.$queryRaw<{ owed: Dec | null; overdue: Dec | null; open: bigint }[]>`
      SELECT SUM(${owedSql()}) AS owed,
             SUM(CASE WHEN "dueDate" < ${today}::date THEN ${owedSql()} ELSE 0 END) AS overdue, COUNT(*) AS open
        FROM "Sale" WHERE "status" = 'COMPLETED' AND ${owedSql()} > 0`,
    opts.valuation
      ? db.$queryRaw<{ v: Dec | null }[]>`SELECT SUM(b."quantity" * p."avgCost") AS v FROM "StockBalance" b JOIN "Product" p ON p."id" = b."productId"`
      : Promise.resolve([{ v: null }]),
    db.sale.findMany({ where: { status: { in: ["COMPLETED", "CANCELLED"] } }, orderBy: { createdAt: "desc" }, take: 6, include: { customer: { select: { name: true } }, salesperson: { select: { name: true } } } }),
    db.saleReversal.count({ where: { status: "PENDING" } }),
    db.$queryRaw<{ id: string; name: string; owed: Dec | null }[]>`
      SELECT c."id", c."name", SUM(${owedSql("s")}) AS owed
        FROM "Sale" s JOIN "Customer" c ON c."id" = s."customerId" WHERE s."status" = 'COMPLETED' AND ${owedSql("s")} > 0
       GROUP BY c."id", c."name" ORDER BY owed DESC LIMIT 5`,
  ]);

  const byDay = new Map(daily.map((d) => [d.day, { sales: n(d.sales), n: Number(d.n) }]));
  const trend = range.days.map((day) => ({ day, label: day.slice(8) + "/" + day.slice(5, 7), sales: byDay.get(day)?.sales ?? 0, count: byDay.get(day)?.n ?? 0 }));

  const change = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : null);
  return {
    kpi: {
      sales: { value: cur.sales, change: change(cur.sales, prev.sales), count: cur.count },
      cash: { value: curCash.total, change: change(curCash.total, prevCash.total), byMethod: curCash.byMethod },
      profit: opts.financials ? { value: cur.profit, change: change(cur.profit, prev.profit), margin: cur.sales > 0 ? (cur.profit / cur.sales) * 100 : 0 } : null,
      debt: { value: n(debt[0]?.owed), overdue: n(debt[0]?.overdue), open: Number(debt[0]?.open ?? 0) },
      stockValue: opts.valuation ? n(stockValue[0]?.v) : null,
      avgSale: cur.count > 0 ? cur.sales / cur.count : 0,
    },
    trend,
    byCategory: byCategory.map((c) => ({ name: c.name, value: n(c.value) })).filter((c) => c.value > 0),
    topProducts: topProducts.map((p) => ({ id: p.id, name: p.name, value: n(p.value), units: n(p.units) })),
    staff: staff.map((s) => ({ id: s.id, name: s.name, sales: n(s.sales), count: Number(s.n) })),
    paymentMix: Object.entries(curCash.byMethod).map(([method, value]) => ({ method, value })),
    recent,
    pendingApprovals,
    debtors: debtors.map((d) => ({ id: d.id, name: d.name, owed: n(d.owed) })),
  };
}

// ───────────── Extra figures for the home page ─────────────

export type OwnerExtras = Awaited<ReturnType<typeof getOwnerExtras>>;

/**
 * What the home page needs beyond the headline numbers: today at a glance, money received by day and method,
 * sales by weekday, expenses by category and the stock held by resellers. Everything is read from real records.
 */
export async function getOwnerExtras(db: Db, range: DateRange, opts: { resellers: boolean; expenses: boolean }) {
  const today = todayYmd();
  const todayStart = new Date(`${today}T00:00:00+03:00`);
  const todayEnd = new Date(todayStart.getTime() + 86_400_000 - 1);
  const day = (col: string) => Prisma.raw(`("${col}" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Dar_es_Salaam')::date`);

  const [todaySales, todayMoney, money, weekday, expenses, resellers] = await Promise.all([
    db.$queryRaw<{ sales: Dec | null; n: bigint }[]>`SELECT SUM("total" - "returnedTotal") AS sales, COUNT(*) AS n FROM "Sale" WHERE "status" = 'COMPLETED' AND "createdAt" >= ${todayStart} AND "createdAt" <= ${todayEnd}`,
    db.payment.aggregate({ where: { receivedAt: { gte: todayStart, lte: todayEnd } }, _sum: { amount: true } }),
    db.$queryRaw<{ d: string; method: string; v: Dec | null }[]>`
      SELECT to_char(${day("receivedAt")}, 'YYYY-MM-DD') AS d, "method"::text AS method, SUM("amount") AS v
        FROM "Payment" WHERE "receivedAt" >= ${range.from} AND "receivedAt" <= ${range.to} GROUP BY 1, 2`,
    db.$queryRaw<{ dow: number; v: Dec | null }[]>`
      SELECT EXTRACT(DOW FROM ${day("createdAt")})::int AS dow, SUM("total" - "returnedTotal") AS v
        FROM "Sale" WHERE "status" = 'COMPLETED' AND "createdAt" >= ${range.from} AND "createdAt" <= ${range.to} GROUP BY 1`,
    opts.expenses
      ? db.$queryRaw<{ name: string; v: Dec | null }[]>`
          SELECT c."name", SUM(e."amount") AS v FROM "Expense" e JOIN "ExpenseCategory" c ON c."id" = e."categoryId"
           WHERE e."status" = 'APPROVED' AND e."expenseDate" >= ${range.fromYmd}::date AND e."expenseDate" <= ${range.toYmd}::date GROUP BY c."name" ORDER BY v DESC`
      : Promise.resolve([] as { name: string; v: Dec | null }[]),
    opts.resellers
      ? db.$queryRaw<{ held: Dec | null; owed: Dec | null; overdue: Dec | null; n: bigint }[]>`
          SELECT (SELECT COUNT(*) FROM "Reseller" WHERE "status" = 'ACTIVE') AS n,
                 (SELECT SUM(b."quantity" * COALESCE((SELECT i."basePrice" FROM "ResellerIssueItem" i JOIN "ResellerIssue" s ON s."id" = i."issueId" WHERE s."resellerId" = r."id" AND i."productId" = b."productId" ORDER BY s."createdAt" DESC LIMIT 1), 0))
                    FROM "Reseller" r JOIN "StockBalance" b ON b."locationId" = r."locationId") AS held,
                 (SELECT SUM(${owedSql()}) FROM "Sale" WHERE "channel" = 'RESELLER' AND "status" = 'COMPLETED') AS owed,
                 (SELECT SUM(${owedSql()}) FROM "Sale" WHERE "channel" = 'RESELLER' AND "status" = 'COMPLETED' AND "dueDate" < ${today}::date) AS overdue`
      : Promise.resolve([] as { held: Dec | null; owed: Dec | null; overdue: Dec | null; n: bigint }[]),
  ]);

  const byDay = new Map<string, { CASH: number; MOBILE_MONEY: number; BANK: number }>();
  for (const r of money) {
    const row = byDay.get(r.d) ?? { CASH: 0, MOBILE_MONEY: 0, BANK: 0 };
    row[r.method as "CASH" | "MOBILE_MONEY" | "BANK"] += n(r.v);
    byDay.set(r.d, row);
  }
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const order = [1, 2, 3, 4, 5, 6, 0]; // week starts on Monday
  return {
    today: { sales: n(todaySales[0]?.sales), count: Number(todaySales[0]?.n ?? 0), money: n(todayMoney._sum.amount) },
    moneyTrend: range.days.map((d) => ({ label: d.slice(8) + "/" + d.slice(5, 7), cash: byDay.get(d)?.CASH ?? 0, mobile: byDay.get(d)?.MOBILE_MONEY ?? 0, bank: byDay.get(d)?.BANK ?? 0 })),
    weekday: order.map((i) => ({ name: names[i]!, value: n(weekday.find((w) => w.dow === i)?.v) })),
    expenses: expenses.map((e) => ({ name: e.name, value: n(e.v) })).filter((e) => e.value > 0),
    resellers: resellers[0] ? { count: Number(resellers[0].n), held: n(resellers[0].held), owed: n(resellers[0].owed), overdue: n(resellers[0].overdue) } : null,
  };
}
