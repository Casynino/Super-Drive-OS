// How each customer is doing: what they bought, whether they pay on time, what moved in a period.
// Read-only and derived from the records (sales and payments); nothing is stored and no money logic is touched.
// The same ideas as the Winga performance, for every customer.
import { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";
import { owedSql } from "@/lib/sales/owed";
import { todayYmd, type Standing } from "@/lib/resellers/performance";

export { PERIODS, emptyStanding, periodRange, todayYmd, type PeriodKey, type Standing } from "@/lib/resellers/performance";

const D = Prisma.Decimal;
const TZ = "Africa/Dar_es_Salaam";
const shiftYmd = (ymd: string, days: number) => new Date(new Date(`${ymd}T12:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);

/** Pays-on-time standing for every customer that has invoices with a due date (one query). */
export async function getCustomerStandings(db: Pick<Db, "$queryRaw">): Promise<Map<string, Standing>> {
  const today = todayYmd();
  const owed = owedSql("s");
  const rows = await db.$queryRaw<{ id: string; ontime: bigint; late_paid: bigint; late_open: bigint; open_n: bigint; oldest: number | null; next_days: number | null }[]>`
    SELECT s."customerId" AS id,
           COUNT(*) FILTER (WHERE ${owed} <= 0 AND lp.paid_at IS NOT NULL AND (lp.paid_at AT TIME ZONE ${TZ})::date <= s."dueDate") AS ontime,
           COUNT(*) FILTER (WHERE ${owed} <= 0 AND lp.paid_at IS NOT NULL AND (lp.paid_at AT TIME ZONE ${TZ})::date > s."dueDate") AS late_paid,
           COUNT(*) FILTER (WHERE ${owed} > 0 AND s."dueDate" < ${today}::date) AS late_open,
           COUNT(*) FILTER (WHERE ${owed} > 0) AS open_n,
           MAX(${today}::date - s."dueDate") FILTER (WHERE ${owed} > 0 AND s."dueDate" < ${today}::date)::int AS oldest,
           MIN(s."dueDate" - ${today}::date) FILTER (WHERE ${owed} > 0 AND s."dueDate" >= ${today}::date)::int AS next_days
      FROM "Sale" s
      LEFT JOIN LATERAL (SELECT MAX(p."receivedAt") AS paid_at FROM "PaymentAllocation" a JOIN "Payment" p ON p."id" = a."paymentId" WHERE a."saleId" = s."id") lp ON true
     WHERE s."customerId" IS NOT NULL AND s."status" = 'COMPLETED' AND s."dueDate" IS NOT NULL
     GROUP BY s."customerId"`;
  return new Map(
    rows.map((r) => {
      const ok = Number(r.ontime);
      const of = ok + Number(r.late_paid) + Number(r.late_open);
      const st: Standing = { onTimePct: of > 0 ? Math.round((ok / of) * 100) : null, onTimeOf: of, lateInvoices: Number(r.late_open), oldestLateDays: r.oldest, nextDueDays: r.next_days, openInvoices: Number(r.open_n) };
      return [r.id, st];
    }),
  );
}

export type Lifetime = { orders: number; bought: Prisma.Decimal; lastAt: Date | null; firstAt: Date | null };
export const emptyLifetime: Lifetime = { orders: 0, bought: new D(0), lastAt: null, firstAt: null };

/** What every customer bought over time (after returns), how many orders, first and last purchase. */
export async function getCustomerLifetimes(db: Pick<Db, "$queryRaw">): Promise<Map<string, Lifetime>> {
  const rows = await db.$queryRaw<{ id: string; n: bigint; bought: Prisma.Decimal | null; last: Date | null; first: Date | null }[]>`
    SELECT "customerId" AS id, COUNT(*) AS n, SUM("total" - "returnedTotal") AS bought, MAX("createdAt") AS last, MIN("createdAt") AS first
      FROM "Sale" WHERE "customerId" IS NOT NULL AND "status" = 'COMPLETED' GROUP BY "customerId"`;
  return new Map(rows.map((r) => [r.id, { orders: Number(r.n), bought: new D(r.bought ?? 0), lastAt: r.last, firstAt: r.first }]));
}

export type PeriodStats = { orders: number; bought: Prisma.Decimal; paid: Prisma.Decimal; average: Prisma.Decimal };

/** What one customer bought and paid inside a period. */
export async function getCustomerPeriodStats(db: Pick<Db, "$queryRaw" | "payment">, customerId: string, range: { from: Date | null; to: Date }): Promise<PeriodStats> {
  const from = range.from ?? new Date("2000-01-01T00:00:00Z");
  const [sales, paid] = await Promise.all([
    db.$queryRaw<{ n: bigint; v: Prisma.Decimal | null }[]>`
      SELECT COUNT(*) AS n, SUM("total" - "returnedTotal") AS v FROM "Sale"
       WHERE "customerId" = ${customerId} AND "status" = 'COMPLETED' AND "createdAt" >= ${from} AND "createdAt" <= ${range.to}`,
    db.payment.aggregate({ where: { customerId, receivedAt: { gte: from, lte: range.to } }, _sum: { amount: true } }),
  ]);
  const orders = Number(sales[0]?.n ?? 0);
  const bought = new D(sales[0]?.v ?? 0);
  return { orders, bought, paid: new D(paid._sum.amount ?? 0), average: orders > 0 ? bought.div(orders) : new D(0) };
}

/** Value bought per day for the last 30 days (zero days included), for the chart. */
export async function getCustomerDaily(db: Pick<Db, "$queryRaw">, customerId: string): Promise<{ label: string; sales: number; count: number }[]> {
  const today = todayYmd();
  const first = shiftYmd(today, -29);
  const rows = await db.$queryRaw<{ day: string; value: Prisma.Decimal; n: bigint }[]>`
    SELECT to_char(("createdAt" AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS day, SUM("total" - "returnedTotal") AS value, COUNT(*) AS n
      FROM "Sale" WHERE "customerId" = ${customerId} AND "status" = 'COMPLETED' AND ("createdAt" AT TIME ZONE ${TZ})::date >= ${first}::date
     GROUP BY 1`;
  const by = new Map(rows.map((r) => [r.day, r]));
  return Array.from({ length: 30 }, (_, i) => {
    const ymd = shiftYmd(first, i);
    const r = by.get(ymd);
    return { label: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`)), sales: Number(r?.value ?? 0), count: Number(r?.n ?? 0) };
  });
}

export type CustomerTone = "red" | "yellow" | "green" | "slate";

/** One word for where a customer stands: inactive, late, has open invoices, paid up, or new. */
export function customerStatus(i: { inactive: boolean; lateInvoices: number; openInvoices: number; orders: number }): { key: "inactive" | "late" | "owing" | "paid" | "new"; label: string; tone: CustomerTone } {
  if (i.inactive) return { key: "inactive", label: "Inactive", tone: "slate" };
  if (i.lateInvoices > 0) return { key: "late", label: `${i.lateInvoices} late`, tone: "red" };
  if (i.openInvoices > 0) return { key: "owing", label: `${i.openInvoices} open`, tone: "yellow" };
  if (i.orders > 0) return { key: "paid", label: "Paid up", tone: "green" };
  return { key: "new", label: "New", tone: "slate" };
}

