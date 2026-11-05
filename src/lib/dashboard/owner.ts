// Numbers for the owner / manager dashboard. Everything comes from real records, in one place, so every
// tile and chart can be traced back to transactions. Money is "net": after returns and refunds.
import { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";
import { owedSql } from "@/lib/sales/owed";
import type { DateRange } from "./range";

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
