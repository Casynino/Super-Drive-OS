// Weekly and monthly business report: worked out from recorded transactions only, shown on a page and sent on WhatsApp
// with a link to that page. Money figures come from getMoneySummary (the cash ledger), so they agree with Income,
// Expenses and the General Ledger.
import { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";
import { getMoneySummary } from "@/lib/cash/summary";
import { dayToDate } from "@/lib/cash/ledger";
import { getBusinessProfile, getCurrency } from "@/lib/settings";
import { longDate, periodsEndingOn, shiftDay } from "./format";
export { periodsEndingOn, shiftDay };

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const TZ = `AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Dar_es_Salaam'`;

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

/** Profit worked out from the sales themselves: what was sold (after returns) minus what the goods cost us. Expenses come off for the net figure. */
export async function getProfit(db: Db, expenses: Dec, from?: string, to?: string) {
  const f = from ? Prisma.sql`AND (s."createdAt" ${Prisma.raw(TZ)})::date >= ${from}::date` : Prisma.empty;
  const t = to ? Prisma.sql`AND (s."createdAt" ${Prisma.raw(TZ)})::date <= ${to}::date` : Prisma.empty;
  const [tot, restored] = await Promise.all([
    db.$queryRaw<{ sales: Dec | null; cogs: Dec | null }[]>`
      SELECT SUM(s."total" - s."returnedTotal") AS sales, SUM(s."cogsTotal") AS cogs FROM "Sale" s WHERE s."status" = 'COMPLETED' ${f} ${t}`,
    db.$queryRaw<{ v: Dec | null }[]>`
      SELECT SUM(ri."costValue") AS v FROM "ReversalItem" ri JOIN "SaleReversal" rv ON rv."id" = ri."reversalId" JOIN "Sale" s ON s."id" = rv."saleId"
       WHERE rv."status" = 'COMPLETED' AND s."status" = 'COMPLETED' ${f} ${t}`,
  ]);
  const sales = new D(tot[0]?.sales ?? 0);
  const cost = new D(tot[0]?.cogs ?? 0).minus(restoredValue(restored));
  const gross = sales.minus(cost);
  const net = gross.minus(expenses);
  return { sales, cost, gross, net, marginPct: sales.gt(0) ? net.div(sales).mul(100).toNumber() : 0 };
}
const restoredValue = (r: { v: Dec | null }[]) => new D(r[0]?.v ?? 0);

/** Sales (after returns) for each day that had any, between two days (inclusive). */
export async function getSalesPerDay(db: Db, locationId: string, from: string, to: string): Promise<{ day: string; total: Dec; count: number }[]> {
  const rows = await db.$queryRaw<{ day: string; n: bigint; v: Dec | null }[]>`
    SELECT (s."createdAt" ${Prisma.raw(TZ)})::date::text AS day, COUNT(*) AS n, SUM(s."total" - s."returnedTotal") AS v
      FROM "Sale" s WHERE s."status" = 'COMPLETED' AND s."locationId" = ${locationId}
       AND (s."createdAt" ${Prisma.raw(TZ)})::date BETWEEN ${from}::date AND ${to}::date GROUP BY 1 ORDER BY 1`;
  return rows.map((r) => ({ day: r.day, total: new D(r.v ?? 0), count: Number(r.n) }));
}

/** What each product sold on the days between two dates (after returns): quantity in its base unit, revenue and cost. */
/** Sales of one day by the hour they were made (Tanzania time). */
export async function getSalesByHour(db: Db, locationId: string, day: string): Promise<{ hour: number; total: Dec; count: number }[]> {
  const rows = await db.$queryRaw<{ h: number; n: bigint; v: Dec | null }[]>`
    SELECT EXTRACT(HOUR FROM (s."createdAt" ${Prisma.raw(TZ)}))::int AS h, COUNT(*) AS n, SUM(s."total" - s."returnedTotal") AS v
      FROM "Sale" s WHERE s."status" = 'COMPLETED' AND s."locationId" = ${locationId} AND (s."createdAt" ${Prisma.raw(TZ)})::date = ${day}::date
     GROUP BY 1 ORDER BY 1`;
  return rows.map((r) => ({ hour: Number(r.h), total: new D(r.v ?? 0), count: Number(r.n) }));
}

export async function getProductsSold(db: Db, locationId: string, from: string, to: string): Promise<{ id: string; name: string; qty: Dec; revenue: Dec; cost: Dec }[]> {
  const rows = await db.$queryRaw<{ id: string; name: string; qty: Dec | null; revenue: Dec | null; cost: Dec | null }[]>`
    SELECT p."id", p."name", SUM(si."quantity" - COALESCE(x.q, 0)) AS qty, SUM(si."lineTotal" - COALESCE(x.v, 0)) AS revenue, SUM(si."costTotal" - COALESCE(x.c, 0)) AS cost
      FROM "SaleItem" si JOIN "Sale" s ON s."id" = si."saleId" JOIN "Product" p ON p."id" = si."productId"
      LEFT JOIN (SELECT ri."saleItemId", SUM(ri."quantity") AS q, SUM(ri."returnValue") AS v, SUM(ri."costValue") AS c FROM "ReversalItem" ri JOIN "SaleReversal" rv ON rv."id" = ri."reversalId" WHERE rv."status" = 'COMPLETED' GROUP BY 1) x ON x."saleItemId" = si."id"
     WHERE s."status" = 'COMPLETED' AND s."locationId" = ${locationId} AND (s."createdAt" ${Prisma.raw(TZ)})::date BETWEEN ${from}::date AND ${to}::date
     GROUP BY p."id", p."name" ORDER BY revenue DESC`;
  return rows.map((r) => ({ id: r.id, name: r.name, qty: new D(r.qty ?? 0), revenue: new D(r.revenue ?? 0), cost: new D(r.cost ?? 0) }));
}

export type PeriodStats = {
  from: string;
  to: string;
  days: number;
  sales: { count: number; total: Dec; creditGiven: Dec; perDay: { day: string; total: Dec; count: number }[]; previousTotal: Dec };
  paidAtSale: { CASH: Dec; MOBILE_MONEY: Dec; BANK: Dec };
  collected: Dec;
  money: Awaited<ReturnType<typeof getMoneySummary>>;
  expensesByCategory: { name: string; value: Dec }[];
  topProducts: { name: string; value: Dec }[];
  closings: { count: number; daysInPeriod: number; short: Dec; extra: Dec };
  banked: Dec;
  profit: Awaited<ReturnType<typeof getProfit>>;
};

export async function getPeriodStats(db: Db, locationId: string, from: string, to: string): Promise<PeriodStats> {
  const days = daysBetween(from, to);
  const prevTo = shiftDay(from, -1);
  const prevFrom = shiftDay(from, -days);
  const [perDay, credit, atSale, collected, categories, top, closings, banked, previous, money] = await Promise.all([
    db.$queryRaw<{ day: string; n: bigint; v: Dec | null }[]>`
      SELECT (s."createdAt" ${Prisma.raw(TZ)})::date::text AS day, COUNT(*) AS n, SUM(s."total" - s."returnedTotal") AS v
        FROM "Sale" s WHERE s."status" = 'COMPLETED' AND s."locationId" = ${locationId}
         AND (s."createdAt" ${Prisma.raw(TZ)})::date BETWEEN ${from}::date AND ${to}::date GROUP BY 1 ORDER BY 1`,
    db.$queryRaw<{ v: Dec | null }[]>`
      SELECT SUM(GREATEST(s."total" - COALESCE(a.paid, 0), 0)) AS v FROM "Sale" s
        LEFT JOIN (SELECT pa."saleId", SUM(pa."amount") AS paid FROM "PaymentAllocation" pa JOIN "Payment" p ON p."id" = pa."paymentId" WHERE p."source" = 'AT_SALE' GROUP BY 1) a ON a."saleId" = s."id"
       WHERE s."status" = 'COMPLETED' AND s."locationId" = ${locationId} AND (s."createdAt" ${Prisma.raw(TZ)})::date BETWEEN ${from}::date AND ${to}::date`,
    db.$queryRaw<{ method: "CASH" | "MOBILE_MONEY" | "BANK"; v: Dec | null }[]>`
      SELECT p."method", SUM(p."amount") AS v FROM "Payment" p
       WHERE p."source" = 'AT_SALE' AND (p."receivedAt" ${Prisma.raw(TZ)})::date BETWEEN ${from}::date AND ${to}::date GROUP BY 1`,
    db.$queryRaw<{ v: Dec | null }[]>`
      SELECT SUM(p."amount") AS v FROM "Payment" p
       WHERE p."source" = 'DEBT_COLLECTION' AND (p."receivedAt" ${Prisma.raw(TZ)})::date BETWEEN ${from}::date AND ${to}::date`,
    db.expense.groupBy({ by: ["categoryId"], where: { status: "APPROVED", locationId, expenseDate: { gte: dayToDate(from), lte: dayToDate(to) } }, _sum: { amount: true } }),
    db.$queryRaw<{ name: string; v: Dec | null }[]>`
      SELECT p."name", SUM(si."lineTotal") AS v FROM "SaleItem" si JOIN "Sale" s ON s."id" = si."saleId" JOIN "Product" p ON p."id" = si."productId"
       WHERE s."status" = 'COMPLETED' AND s."locationId" = ${locationId} AND (s."createdAt" ${Prisma.raw(TZ)})::date BETWEEN ${from}::date AND ${to}::date
       GROUP BY p."name" ORDER BY v DESC LIMIT 6`,
    db.dailyClosing.findMany({ where: { locationId, businessDate: { gte: dayToDate(from), lte: dayToDate(to) } }, select: { difference: true, status: true } }),
    db.bankDeposit.aggregate({ where: { locationId, businessDate: { gte: dayToDate(from), lte: dayToDate(to) } }, _sum: { amount: true } }),
    db.$queryRaw<{ v: Dec | null }[]>`
      SELECT SUM(s."total" - s."returnedTotal") AS v FROM "Sale" s WHERE s."status" = 'COMPLETED' AND s."locationId" = ${locationId}
         AND (s."createdAt" ${Prisma.raw(TZ)})::date BETWEEN ${prevFrom}::date AND ${prevTo}::date`,
    getMoneySummary(db, locationId, { from, to }),
  ]);
  const profit = await getProfit(db, money.expenses, from, to);
  const names = categories.length ? await db.expenseCategory.findMany({ where: { id: { in: categories.map((c) => c.categoryId) } }, select: { id: true, name: true } }) : [];
  const paid = { CASH: new D(0), MOBILE_MONEY: new D(0), BANK: new D(0) };
  for (const r of atSale) paid[r.method] = new D(r.v ?? 0);
  let short = new D(0), extra = new D(0);
  for (const c of closings) {
    if (c.difference.lt(0)) short = short.plus(c.difference.abs());
    else if (c.difference.gt(0)) extra = extra.plus(c.difference);
  }
  const salesPerDay = perDay.map((r) => ({ day: r.day, total: new D(r.v ?? 0), count: Number(r.n) }));
  return {
    from,
    to,
    days,
    sales: { count: salesPerDay.reduce((t, r) => t + r.count, 0), total: salesPerDay.reduce((t, r) => t.plus(r.total), new D(0)), creditGiven: new D(credit[0]?.v ?? 0), perDay: salesPerDay, previousTotal: new D(previous[0]?.v ?? 0) },
    paidAtSale: paid,
    collected: new D(collected[0]?.v ?? 0),
    money,
    expensesByCategory: categories
      .map((c) => ({ name: names.find((n) => n.id === c.categoryId)?.name ?? "Other", value: new D(c._sum.amount ?? 0) }))
      .filter((c) => c.value.gt(0))
      .sort((a, b) => b.value.comparedTo(a.value)),
    topProducts: top.map((t) => ({ name: t.name, value: new D(t.v ?? 0) })),
    closings: { count: closings.length, daysInPeriod: days, short, extra },
    banked: new D(banked._sum.amount ?? 0),
    profit,
  };
}

/** The share of change against the period before, as text ("up 12%"), or null when there is nothing to compare with. */
export function changeText(now: Dec, before: Dec): string | null {
  if (!before.gt(0)) return null;
  const pct = now.minus(before).div(before).mul(100).toNumber();
  return `${pct >= 0 ? "up" : "down"} ${Math.abs(Math.round(pct))}% on the period before`;
}

/** The WhatsApp message for a week or a month: short, with a link to the full page when the web address is known. */
export async function buildPeriodMessage(db: Db, locationId: string, kind: "WEEKLY" | "MONTHLY", from: string, to: string, baseUrl: string | null) {
  const [currency, biz, s] = await Promise.all([getCurrency(), getBusinessProfile(), getPeriodStats(db, locationId, from, to)]);
  const m = (v: Dec | number) => `${currency.code} ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(Number(v)))}`;
  const name = biz.name.toUpperCase();
  const change = changeText(s.sales.total, s.sales.previousTotal);
  const lines = [
    name,
    kind === "WEEKLY" ? "WEEKLY BUSINESS REPORT" : "MONTHLY BUSINESS REPORT",
    `${longDate(from)} to ${longDate(to)}`,
    "",
    "SALES",
    `Total Sales: ${m(s.sales.total)} (${s.sales.count} sale${s.sales.count === 1 ? "" : "s"})${change ? ` · ${change}` : ""}`,
    `Cash: ${m(s.paidAtSale.CASH)} · Mobile: ${m(s.paidAtSale.MOBILE_MONEY)} · Bank: ${m(s.paidAtSale.BANK)}`,
    `On Credit: ${m(s.sales.creditGiven)}`,
    `Debts Collected: ${m(s.collected)}`,
    "",
    "MONEY",
    `Income: ${m(s.money.income)}`,
    `Spent: ${m(s.money.spent)} (expenses ${m(s.money.expenses)}, suppliers ${m(s.money.suppliers)}, owner ${m(s.money.withdrawals)})`,
    `Left: ${m(s.money.left)}`,
    `Profit: ${m(s.profit.net)} (${s.profit.marginPct.toFixed(1)}% of sales, after expenses)`,
    `Banked: ${m(s.banked)}`,
    "",
    "CASH COUNT",
    `Days closed: ${s.closings.count} of ${s.closings.daysInPeriod}`,
    `Short: ${m(s.closings.short)}${s.closings.extra.gt(0) ? ` · Extra: ${m(s.closings.extra)}` : ""}`,
  ];
  if (s.expensesByCategory.length) lines.push("", "BIGGEST EXPENSES", ...s.expensesByCategory.slice(0, 3).map((c) => `${c.name}: ${m(c.value)}`));
  if (s.topProducts.length) lines.push("", "BEST SELLERS", ...s.topProducts.slice(0, 3).map((p) => `${p.name}: ${m(p.value)}`));
  if (baseUrl) lines.push("", "Full report (open, download or print):", `${baseUrl}/print/report?from=${from}&to=${to}`);
  lines.push("", `${name} MANAGEMENT SYSTEM`);
  return lines.join("\n");
}
