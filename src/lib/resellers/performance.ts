// How each winga (reseller) is doing: do they pay on time, how much of what they took did they sell, what moved in a period.
// Read-only and derived from the records (sales, issues, returns, payments); nothing is stored and no money logic is touched.
import { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";
import { owedSql } from "@/lib/sales/owed";

const D = Prisma.Decimal;
const TZ = "Africa/Dar_es_Salaam";
type Q = Pick<Db, "$queryRaw" | "payment">;

export const todayYmd = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const shiftYmd = (ymd: string, days: number) => new Date(new Date(`${ymd}T12:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
const startOf = (ymd: string) => new Date(`${ymd}T00:00:00+03:00`);
const endOf = (ymd: string) => new Date(`${ymd}T23:59:59.999+03:00`);

export type Standing = {
  /** invoices paid in full by their due date, among all that are settled or already late; null until one is due */
  onTimePct: number | null;
  onTimeOf: number;
  /** invoices still open and past their due date */
  lateInvoices: number;
  oldestLateDays: number | null;
  /** days until the next open invoice is due (0 = today); null when nothing open is still ahead */
  nextDueDays: number | null;
  openInvoices: number;
};

/** Pays-on-time standing for every winga at once (one query). */
export async function getStandings(db: Pick<Db, "$queryRaw">): Promise<Map<string, Standing>> {
  const today = todayYmd();
  const owed = owedSql("s");
  const rows = await db.$queryRaw<
    { id: string; ontime: bigint; late_paid: bigint; late_open: bigint; open_n: bigint; oldest: number | null; next_days: number | null }[]
  >`
    SELECT s."resellerId" AS id,
           COUNT(*) FILTER (WHERE ${owed} <= 0 AND lp.paid_at IS NOT NULL AND (lp.paid_at AT TIME ZONE ${TZ})::date <= s."dueDate") AS ontime,
           COUNT(*) FILTER (WHERE ${owed} <= 0 AND lp.paid_at IS NOT NULL AND (lp.paid_at AT TIME ZONE ${TZ})::date > s."dueDate") AS late_paid,
           COUNT(*) FILTER (WHERE ${owed} > 0 AND s."dueDate" < ${today}::date) AS late_open,
           COUNT(*) FILTER (WHERE ${owed} > 0) AS open_n,
           MAX(${today}::date - s."dueDate") FILTER (WHERE ${owed} > 0 AND s."dueDate" < ${today}::date)::int AS oldest,
           MIN(s."dueDate" - ${today}::date) FILTER (WHERE ${owed} > 0 AND s."dueDate" >= ${today}::date)::int AS next_days
      FROM "Sale" s
      LEFT JOIN LATERAL (SELECT MAX(p."receivedAt") AS paid_at FROM "PaymentAllocation" a JOIN "Payment" p ON p."id" = a."paymentId" WHERE a."saleId" = s."id") lp ON true
     WHERE s."resellerId" IS NOT NULL AND s."status" = 'COMPLETED' AND s."dueDate" IS NOT NULL
     GROUP BY s."resellerId"`;
  return new Map(
    rows.map((r) => {
      const ok = Number(r.ontime);
      const of = ok + Number(r.late_paid) + Number(r.late_open);
      return [r.id, { onTimePct: of > 0 ? Math.round((ok / of) * 100) : null, onTimeOf: of, lateInvoices: Number(r.late_open), oldestLateDays: r.oldest, nextDueDays: r.next_days, openInvoices: Number(r.open_n) }];
    }),
  );
}

export const emptyStanding: Standing = { onTimePct: null, onTimeOf: 0, lateInvoices: 0, oldestLateDays: null, nextDueDays: null, openInvoices: 0 };

export type PeriodKey = "today" | "week" | "month" | "all";
export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "all", label: "All time" },
];

/** [from, to] for a period in the business time zone ("week" = the last 7 days including today); from is null for all time. */
export function periodRange(key: PeriodKey): { from: Date | null; to: Date } {
  const today = todayYmd();
  const to = endOf(today);
  if (key === "all") return { from: null, to };
  const fromYmd = key === "today" ? today : key === "week" ? shiftYmd(today, -6) : `${today.slice(0, 8)}01`;
  return { from: startOf(fromYmd), to };
}

export type PeriodStats = { receivedQty: Prisma.Decimal; receivedValue: Prisma.Decimal; soldQty: Prisma.Decimal; soldValue: Prisma.Decimal; reports: number; returnedQty: Prisma.Decimal; returns: number; collected: Prisma.Decimal };

/** What moved for one winga inside a period: stock received, sold, returned, and money collected. */
export async function getPeriodStats(db: Q, resellerId: string, customerId: string, range: { from: Date | null; to: Date }): Promise<PeriodStats> {
  const from = range.from ?? new Date("2000-01-01T00:00:00Z");
  const [rec, sold, ret, paid] = await Promise.all([
    db.$queryRaw<{ qty: Prisma.Decimal | null; value: Prisma.Decimal | null }[]>`
      SELECT SUM(i."quantity") AS qty, SUM(i."lineValue") AS value FROM "ResellerIssueItem" i JOIN "ResellerIssue" s ON s."id" = i."issueId"
       WHERE s."resellerId" = ${resellerId} AND s."createdAt" >= ${from} AND s."createdAt" <= ${range.to}`,
    db.$queryRaw<{ qty: Prisma.Decimal | null; value: Prisma.Decimal | null; n: bigint }[]>`
      SELECT (SELECT SUM(si."quantity" - COALESCE(r.q, 0)) FROM "SaleItem" si
                LEFT JOIN (SELECT ri."saleItemId", SUM(ri."quantity") AS q FROM "ReversalItem" ri JOIN "SaleReversal" rv ON rv."id" = ri."reversalId" WHERE rv."status" = 'COMPLETED' GROUP BY 1) r ON r."saleItemId" = si."id"
               WHERE si."saleId" IN (SELECT "id" FROM "Sale" WHERE "resellerId" = ${resellerId} AND "status" = 'COMPLETED' AND "createdAt" >= ${from} AND "createdAt" <= ${range.to})) AS qty,
             SUM("total" - "returnedTotal") AS value, COUNT(*) AS n
        FROM "Sale" WHERE "resellerId" = ${resellerId} AND "status" = 'COMPLETED' AND "createdAt" >= ${from} AND "createdAt" <= ${range.to}`,
    db.$queryRaw<{ qty: Prisma.Decimal | null; n: bigint }[]>`
      SELECT SUM(i."quantity") AS qty, COUNT(DISTINCT r."id") AS n FROM "ResellerReturnItem" i JOIN "ResellerReturn" r ON r."id" = i."returnId"
       WHERE r."resellerId" = ${resellerId} AND r."createdAt" >= ${from} AND r."createdAt" <= ${range.to}`,
    db.payment.aggregate({ where: { customerId, receivedAt: { gte: from, lte: range.to } }, _sum: { amount: true } }),
  ]);
  return {
    receivedQty: new D(rec[0]?.qty ?? 0),
    receivedValue: new D(rec[0]?.value ?? 0),
    soldQty: new D(sold[0]?.qty ?? 0),
    soldValue: new D(sold[0]?.value ?? 0),
    reports: Number(sold[0]?.n ?? 0),
    returnedQty: new D(ret[0]?.qty ?? 0),
    returns: Number(ret[0]?.n ?? 0),
    collected: new D(paid._sum.amount ?? 0),
  };
}

/** Value reported sold per day for the last 30 days (zero days included), for the chart. */
export async function getDailySold(db: Pick<Db, "$queryRaw">, resellerId: string): Promise<{ label: string; sales: number; count: number }[]> {
  const today = todayYmd();
  const first = shiftYmd(today, -29);
  const rows = await db.$queryRaw<{ day: string; value: Prisma.Decimal; n: bigint }[]>`
    SELECT to_char(("createdAt" AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS day, SUM("total" - "returnedTotal") AS value, COUNT(*) AS n
      FROM "Sale" WHERE "resellerId" = ${resellerId} AND "status" = 'COMPLETED' AND ("createdAt" AT TIME ZONE ${TZ})::date >= ${first}::date
     GROUP BY 1`;
  const by = new Map(rows.map((r) => [r.day, r]));
  return Array.from({ length: 30 }, (_, i) => {
    const ymd = shiftYmd(first, i);
    const r = by.get(ymd);
    return { label: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`)), sales: Number(r?.value ?? 0), count: Number(r?.n ?? 0) };
  });
}
