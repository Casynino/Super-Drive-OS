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

// ───────────── The owner's home: this month against last month, and twelve months of history ─────────────

const ymdOf = (d: Date) => d.toISOString().slice(0, 10);
const shiftDay = (s: string, days: number) => {
  const d = new Date(`${s}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return ymdOf(d);
};
const shiftMonth = (firstOfMonth: string, months: number) => {
  const d = new Date(`${firstOfMonth}T00:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return ymdOf(d);
};
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type OwnerOverview = Awaited<ReturnType<typeof getOwnerOverview>>;

/**
 * Month-to-date against the same days of last month, the last twelve months, ageing of debts, best customers and
 * what each product earns. `financials` adds cost and profit (hidden from people who may not see them).
 */
export async function getOwnerOverview(db: Db, opts: { financials: boolean }) {
  const today = todayYmd();
  const first = `${today.slice(0, 8)}01`;
  const dayNo = Number(today.slice(8, 10));
  const prevFirst = shiftMonth(first, -1);
  const prevMonthEnd = shiftDay(first, -1);
  const prevLast = shiftDay(prevFirst, dayNo - 1) > prevMonthEnd ? prevMonthEnd : shiftDay(prevFirst, dayNo - 1);
  const from12 = shiftMonth(first, -11);
  const since = new Date(`${from12}T00:00:00+03:00`);
  const local = (col: string, alias?: string) => Prisma.raw(`(${alias ? `${alias}.` : ""}"${col}" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Dar_es_Salaam')::date`);
  const monthOf = (col: string, alias?: string) => Prisma.raw(`to_char(date_trunc('month', (${alias ? `${alias}.` : ""}"${col}" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Dar_es_Salaam')::date), 'YYYY-MM')`);
  const cur = (d: Prisma.Sql) => Prisma.sql`(${d} >= ${first}::date AND ${d} <= ${today}::date)`;
  const prev = (d: Prisma.Sql) => Prisma.sql`(${d} >= ${prevFirst}::date AND ${d} <= ${prevLast}::date)`;

  const [sales, restored, units, pays, exps, sups, refunds, byMonth, restoredByMonth, aging, customers, products, todayFlow] = await Promise.all([
    db.$queryRaw<{ cs: Dec | null; ps: Dec | null; cn: bigint; pn: bigint; cc: Dec | null; pc: Dec | null }[]>`
      SELECT SUM(CASE WHEN ${cur(local("createdAt"))} THEN "total" - "returnedTotal" END) AS cs, SUM(CASE WHEN ${prev(local("createdAt"))} THEN "total" - "returnedTotal" END) AS ps,
             COUNT(CASE WHEN ${cur(local("createdAt"))} THEN 1 END) AS cn, COUNT(CASE WHEN ${prev(local("createdAt"))} THEN 1 END) AS pn,
             SUM(CASE WHEN ${cur(local("createdAt"))} THEN "cogsTotal" END) AS cc, SUM(CASE WHEN ${prev(local("createdAt"))} THEN "cogsTotal" END) AS pc
        FROM "Sale" WHERE "status" = 'COMPLETED' AND "createdAt" >= ${new Date(`${prevFirst}T00:00:00+03:00`)}`,
    db.$queryRaw<{ c: Dec | null; p: Dec | null }[]>`
      SELECT SUM(CASE WHEN ${cur(local("createdAt", "s"))} THEN ri."costValue" END) AS c, SUM(CASE WHEN ${prev(local("createdAt", "s"))} THEN ri."costValue" END) AS p
        FROM "ReversalItem" ri JOIN "SaleReversal" rv ON rv."id" = ri."reversalId" JOIN "Sale" s ON s."id" = rv."saleId"
       WHERE rv."status" = 'COMPLETED' AND s."status" = 'COMPLETED' AND s."createdAt" >= ${new Date(`${prevFirst}T00:00:00+03:00`)}`,
    db.$queryRaw<{ c: Dec | null; p: Dec | null }[]>`
      SELECT SUM(CASE WHEN ${cur(local("createdAt", "s"))} THEN si."quantity" - COALESCE(x.q, 0) END) AS c, SUM(CASE WHEN ${prev(local("createdAt", "s"))} THEN si."quantity" - COALESCE(x.q, 0) END) AS p
        FROM "SaleItem" si JOIN "Sale" s ON s."id" = si."saleId"
        LEFT JOIN (SELECT ri."saleItemId", SUM(ri."quantity") AS q FROM "ReversalItem" ri JOIN "SaleReversal" rv ON rv."id" = ri."reversalId" WHERE rv."status" = 'COMPLETED' GROUP BY 1) x ON x."saleItemId" = si."id"
       WHERE s."status" = 'COMPLETED' AND s."createdAt" >= ${new Date(`${prevFirst}T00:00:00+03:00`)}`,
    db.$queryRaw<{ c: Dec | null; p: Dec | null }[]>`
      SELECT SUM(CASE WHEN ${cur(local("receivedAt"))} THEN "amount" END) AS c, SUM(CASE WHEN ${prev(local("receivedAt"))} THEN "amount" END) AS p FROM "Payment" WHERE "receivedAt" >= ${new Date(`${prevFirst}T00:00:00+03:00`)}`,
    db.$queryRaw<{ c: Dec | null; p: Dec | null }[]>`
      SELECT SUM(CASE WHEN "expenseDate" >= ${first}::date AND "expenseDate" <= ${today}::date THEN "amount" END) AS c, SUM(CASE WHEN "expenseDate" >= ${prevFirst}::date AND "expenseDate" <= ${prevLast}::date THEN "amount" END) AS p
        FROM "Expense" WHERE "status" = 'APPROVED' AND "expenseDate" >= ${prevFirst}::date`,
    db.$queryRaw<{ c: Dec | null; p: Dec | null }[]>`
      SELECT SUM(CASE WHEN ${cur(local("paidAt"))} THEN "amount" END) AS c, SUM(CASE WHEN ${prev(local("paidAt"))} THEN "amount" END) AS p FROM "SupplierPayment" WHERE "paidAt" >= ${new Date(`${prevFirst}T00:00:00+03:00`)}`,
    db.$queryRaw<{ c: Dec | null; p: Dec | null }[]>`
      SELECT SUM(CASE WHEN ${cur(local("decidedAt"))} THEN "refundAmount" END) AS c, SUM(CASE WHEN ${prev(local("decidedAt"))} THEN "refundAmount" END) AS p
        FROM "SaleReversal" WHERE "status" = 'COMPLETED' AND "refundAmount" > 0 AND "decidedAt" >= ${new Date(`${prevFirst}T00:00:00+03:00`)}`,
    db.$queryRaw<{ m: string; sales: Dec | null; cogs: Dec | null; pay: Dec | null; exp: Dec | null; sup: Dec | null; ref: Dec | null }[]>`
      WITH s AS (SELECT ${monthOf("createdAt")} AS m, SUM("total" - "returnedTotal") AS sales, SUM("cogsTotal") AS cogs FROM "Sale" WHERE "status" = 'COMPLETED' AND "createdAt" >= ${since} GROUP BY 1),
           p AS (SELECT ${monthOf("receivedAt")} AS m, SUM("amount") AS pay FROM "Payment" WHERE "receivedAt" >= ${since} GROUP BY 1),
           e AS (SELECT to_char(date_trunc('month', "expenseDate"), 'YYYY-MM') AS m, SUM("amount") AS exp FROM "Expense" WHERE "status" = 'APPROVED' AND "expenseDate" >= ${from12}::date GROUP BY 1),
           u AS (SELECT ${monthOf("paidAt")} AS m, SUM("amount") AS sup FROM "SupplierPayment" WHERE "paidAt" >= ${since} GROUP BY 1),
           r AS (SELECT ${monthOf("decidedAt")} AS m, SUM("refundAmount") AS ref FROM "SaleReversal" WHERE "status" = 'COMPLETED' AND "decidedAt" >= ${since} GROUP BY 1)
      SELECT m.m, s.sales, s.cogs, p.pay, e.exp, u.sup, r.ref
        FROM (SELECT to_char(g, 'YYYY-MM') AS m FROM generate_series(${from12}::date, ${first}::date, interval '1 month') g) m
        LEFT JOIN s ON s.m = m.m LEFT JOIN p ON p.m = m.m LEFT JOIN e ON e.m = m.m LEFT JOIN u ON u.m = m.m LEFT JOIN r ON r.m = m.m ORDER BY m.m`,
    db.$queryRaw<{ m: string; v: Dec | null }[]>`
      SELECT ${monthOf("createdAt", "s")} AS m, SUM(ri."costValue") AS v FROM "ReversalItem" ri JOIN "SaleReversal" rv ON rv."id" = ri."reversalId" JOIN "Sale" s ON s."id" = rv."saleId"
       WHERE rv."status" = 'COMPLETED' AND s."status" = 'COMPLETED' AND s."createdAt" >= ${since} GROUP BY 1`,
    db.$queryRaw<{ b: number; n: bigint; v: Dec | null; oldest: number | null }[]>`
      SELECT CASE WHEN age <= 7 THEN 0 WHEN age <= 14 THEN 1 WHEN age <= 30 THEN 2 ELSE 3 END AS b, COUNT(*) AS n, SUM(owed) AS v, MAX(age)::int AS oldest
        FROM (SELECT (${today}::date - ${local("createdAt")}) AS age, ${owedSql()} AS owed FROM "Sale" WHERE "status" = 'COMPLETED') t WHERE owed > 0 GROUP BY 1`,
    db.$queryRaw<{ id: string; name: string; billed: Dec | null; owed: Dec | null }[]>`
      SELECT c."id", c."name", SUM(s."total" - s."returnedTotal") AS billed,
             (SELECT SUM(${owedSql("x")}) FROM "Sale" x WHERE x."customerId" = c."id" AND x."status" = 'COMPLETED') AS owed
        FROM "Sale" s JOIN "Customer" c ON c."id" = s."customerId"
       WHERE s."status" = 'COMPLETED' AND ${cur(local("createdAt", "s"))} GROUP BY c."id", c."name" ORDER BY billed DESC LIMIT 6`,
    db.$queryRaw<{ id: string; name: string; units: Dec | null; sales: Dec | null; cost: Dec | null }[]>`
      SELECT p."id", p."name", SUM(si."quantity" - COALESCE(x.q, 0)) AS units, SUM(si."lineTotal" - COALESCE(x.v, 0)) AS sales, SUM(si."costTotal" - COALESCE(x.c, 0)) AS cost
        FROM "SaleItem" si JOIN "Sale" s ON s."id" = si."saleId" JOIN "Product" p ON p."id" = si."productId"
        LEFT JOIN (SELECT ri."saleItemId", SUM(ri."quantity") AS q, SUM(ri."returnValue") AS v, SUM(ri."costValue") AS c FROM "ReversalItem" ri JOIN "SaleReversal" rv ON rv."id" = ri."reversalId" WHERE rv."status" = 'COMPLETED' GROUP BY 1) x ON x."saleItemId" = si."id"
       WHERE s."status" = 'COMPLETED' AND ${cur(local("createdAt", "s"))} GROUP BY p."id", p."name" ORDER BY sales DESC LIMIT 8`,
    db.$queryRaw<{ pay: Dec | null; exp: Dec | null; sup: Dec | null; ref: Dec | null }[]>`
      SELECT (SELECT SUM("amount") FROM "Payment" WHERE ${local("receivedAt")} = ${today}::date) AS pay,
             (SELECT SUM("amount") FROM "Expense" WHERE "status" = 'APPROVED' AND "expenseDate" = ${today}::date) AS exp,
             (SELECT SUM("amount") FROM "SupplierPayment" WHERE ${local("paidAt")} = ${today}::date) AS sup,
             (SELECT SUM("refundAmount") FROM "SaleReversal" WHERE "status" = 'COMPLETED' AND ${local("decidedAt")} = ${today}::date) AS ref`,
  ]);

  const ratio = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : null);
  const restoredBy = new Map(restoredByMonth.map((r) => [r.m, n(r.v)]));
  const s0 = sales[0];
  const curSales = n(s0?.cs);
  const prevSales = n(s0?.ps);
  const curCogs = n(s0?.cc) - n(restored[0]?.c);
  const prevCogs = n(s0?.pc) - n(restored[0]?.p);
  const curProfit = curSales - curCogs;
  const prevProfit = prevSales - prevCogs;
  const curSpent = n(exps[0]?.c);
  const prevSpent = n(exps[0]?.p);
  const curMoney = n(pays[0]?.c);
  const prevMoney = n(pays[0]?.p);
  const year = byMonth.map((r) => {
    const sales = n(r.sales);
    const cogs = n(r.cogs) - (restoredBy.get(r.m) ?? 0);
    const costs = (opts.financials ? cogs : 0) + n(r.exp);
    return { label: MONTH_NAMES[Number(r.m.slice(5, 7)) - 1]!, key: r.m, sales, costs, left: sales - costs, in: n(r.pay), out: n(r.exp) + n(r.sup) + n(r.ref) };
  });
  const bucket = ["This week", "8 to 14 days", "15 to 30 days", "Over 30 days"];
  const agingRows = bucket.map((label, i) => {
    const row = aging.find((a) => a.b === i);
    return { label, count: Number(row?.n ?? 0), value: n(row?.v), oldest: row?.oldest ?? 0 };
  });
  const owedTotal = agingRows.reduce((t, a) => t + a.value, 0);
  const yearSales = year.reduce((t, y) => t + y.sales, 0);
  const todayOut = n(todayFlow[0]?.exp) + n(todayFlow[0]?.sup) + n(todayFlow[0]?.ref);

  return {
    monthLabel: new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(new Date(`${first}T00:00:00Z`)),
    prevMonthLabel: new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(new Date(`${prevFirst}T00:00:00Z`)),
    month: {
      sales: { value: curSales, change: ratio(curSales, prevSales), count: Number(s0?.cn ?? 0) },
      money: { value: curMoney, change: ratio(curMoney, prevMoney) },
      spent: { value: curSpent, change: ratio(curSpent, prevSpent) },
      profit: opts.financials ? { value: curProfit, change: ratio(curProfit, prevProfit) } : null,
      units: { value: n(units[0]?.c), change: ratio(n(units[0]?.c), n(units[0]?.p)) },
      collectionRate: curSales > 0 ? (curMoney / curSales) * 100 : null,
      margin: opts.financials && curSales > 0 ? (curProfit / curSales) * 100 : null,
      expenseRatio: curSales > 0 ? (curSpent / curSales) * 100 : null,
      supplierPaid: n(sups[0]?.c),
      refunded: n(refunds[0]?.c),
    },
    year,
    yearSales,
    outstandingRatio: yearSales > 0 ? (owedTotal / yearSales) * 100 : null,
    aging: agingRows,
    owedTotal,
    oldestOwed: Math.max(0, ...agingRows.map((a) => a.oldest)),
    customers: customers.map((c) => ({ id: c.id, name: c.name, billed: n(c.billed), owed: n(c.owed) })),
    products: products.map((p) => ({ id: p.id, name: p.name, units: n(p.units), sales: n(p.sales), cost: opts.financials ? n(p.cost) : null, profit: opts.financials ? n(p.sales) - n(p.cost) : null })),
    today: { collected: n(todayFlow[0]?.pay), spent: todayOut, net: n(todayFlow[0]?.pay) - todayOut },
  };
}
