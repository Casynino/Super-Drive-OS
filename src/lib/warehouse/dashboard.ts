// The numbers behind the warehouse dashboard and the Director's overview. Quantities are in pieces (the base unit).
import { Prisma, type PickupStatus } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";
import { businessDay } from "@/lib/cash/ledger";
import { getStockAlerts } from "@/lib/inventory/alerts";
import { largestPack } from "@/lib/qty";
import { shiftDay } from "@/lib/reports/period";
import { OPEN_STATUSES } from "./labels";

const n = (v: unknown) => Number(v ?? 0);
const TZ = Prisma.raw(`AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Dar_es_Salaam'`);

export async function getWarehouseSnapshot(db: Db) {
  const today = businessDay();
  const todayStart = new Date(`${today}T00:00:00+03:00`);
  const since = shiftDay(today, -13);
  const sinceDate = new Date(`${since}T00:00:00+03:00`);

  const [stock, productsHeld, statusCounts, openNotes, collectedToday, received, released, inbound, issuesOpen, alerts, oldest] = await Promise.all([
    db.stockBalance.aggregate({ where: { location: { pickupRequired: true } }, _sum: { quantity: true, reserved: true } }),
    db.stockBalance.count({ where: { location: { pickupRequired: true }, quantity: { gt: 0 } } }),
    db.pickupNote.groupBy({ by: ["status"], _count: { _all: true } }),
    db.pickupNote.findMany({ where: { status: { in: OPEN_STATUSES } }, select: { createdAt: true } }),
    db.pickupRelease.count({ where: { createdAt: { gte: todayStart } } }),
    db.$queryRaw<{ d: string; q: Prisma.Decimal | null }[]>`
      SELECT to_char((m."createdAt" ${TZ})::date, 'YYYY-MM-DD') AS d, SUM(m."quantity") AS q
        FROM "StockMovement" m JOIN "Location" l ON l."id" = m."locationId"
       WHERE m."type" = 'RECEIVED' AND l."pickupRequired" AND m."createdAt" >= ${sinceDate} GROUP BY 1`,
    db.$queryRaw<{ d: string; q: Prisma.Decimal | null }[]>`
      SELECT to_char((r."createdAt" ${TZ})::date, 'YYYY-MM-DD') AS d, SUM(i."quantity") AS q
        FROM "PickupReleaseItem" i JOIN "PickupRelease" r ON r."id" = i."releaseId"
       WHERE r."createdAt" >= ${sinceDate} GROUP BY 1`,
    db.shipment.findMany({ where: { status: { in: ["EXPECTED", "PARTIAL"] } }, orderBy: [{ arrivedAt: { sort: "desc", nulls: "last" } }, { expectedDate: "asc" }], take: 6, select: { id: true, shipmentNo: true, cargoName: true, reference: true, expectedDate: true, arrivedAt: true, status: true, supplier: { select: { name: true } }, _count: { select: { items: true } } } }),
    db.shipment.count({ where: { issue: "OPEN" } }),
    getStockAlerts(db),
    db.pickupNote.findFirst({ where: { status: { in: ["NEW", "PREPARING"] } }, orderBy: { createdAt: "asc" }, select: { id: true, noteNo: true, createdAt: true } }),
  ]);

  // analysis: every product on the shelf, orders per day, what moved per product, how fast orders are handed over
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const [shelfProducts, shelfBalances, perDayRows, moveRows, handover] = await Promise.all([
    db.product.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true, minStock: true, baseUnit: { select: { symbol: true } }, units: { select: { factor: true, unit: { select: { symbol: true } } } }, image: { select: { updatedAt: true } } }, orderBy: { name: "asc" } }),
    db.stockBalance.groupBy({ by: ["productId"], where: { location: { pickupRequired: true } }, _sum: { quantity: true, reserved: true } }),
    db.$queryRaw<{ d: string; q: bigint }[]>`
      SELECT to_char((p."createdAt" ${TZ})::date, 'YYYY-MM-DD') AS d, COUNT(*) AS q FROM "PickupNote" p WHERE p."createdAt" >= ${sinceDate} GROUP BY 1`,
    db.$queryRaw<{ pid: string; rin: Prisma.Decimal | null; rout: Prisma.Decimal | null }[]>`
      SELECT m."productId" AS pid,
             SUM(CASE WHEN m."type" = 'RECEIVED' THEN m."quantity" ELSE 0 END) AS rin,
             SUM(CASE WHEN m."type" = 'SOLD' THEN ABS(m."quantity") ELSE 0 END) AS rout
        FROM "StockMovement" m JOIN "Location" l ON l."id" = m."locationId"
       WHERE l."pickupRequired" AND m."type" IN ('RECEIVED', 'SOLD') AND m."createdAt" >= ${sinceDate} GROUP BY 1`,
    db.$queryRaw<{ h: number | null }[]>`
      SELECT AVG(EXTRACT(EPOCH FROM (p."completedAt" - p."createdAt")) / 3600.0)::float AS h FROM "PickupNote" p WHERE p."status" = 'COMPLETED' AND p."completedAt" >= ${since30}`,
  ]);

  const count = (...s: PickupStatus[]) => statusCounts.filter((c) => s.includes(c.status)).reduce((t, c) => t + c._count._all, 0);
  const physical = n(stock._sum.quantity);
  const reserved = n(stock._sum.reserved);

  // how long the waiting orders have been waiting
  const now = Date.now();
  const age = [
    { label: "Today", from: 0, to: 1 },
    { label: "1 to 2 days", from: 1, to: 3 },
    { label: "3 to 6 days", from: 3, to: 7 },
    { label: "A week or more", from: 7, to: Infinity },
  ].map((b) => ({ label: b.label, value: openNotes.filter((o) => { const d = (now - o.createdAt.getTime()) / 86_400_000; return d >= b.from && d < b.to; }).length }));

  // goods in and out over the last two weeks
  const inMap = new Map(received.map((r) => [r.d, n(r.q)]));
  const outMap = new Map(released.map((r) => [r.d, n(r.q)]));
  const days = Array.from({ length: 14 }, (_, i) => shiftDay(since, i)).map((d) => ({ day: d, received: inMap.get(d) ?? 0, released: outMap.get(d) ?? 0 }));

  const bal = new Map(shelfBalances.map((b) => [b.productId, { physical: n(b._sum.quantity), reserved: n(b._sum.reserved) }]));
  const rank = { out: 0, low: 1, ok: 2 } as const;
  const shelf = shelfProducts
    .map((p) => {
      const b = bal.get(p.id);
      const physical = b?.physical ?? 0;
      const reserved = b?.reserved ?? 0;
      const available = physical - reserved;
      const min = n(p.minStock);
      const status: keyof typeof rank = available <= 0 ? "out" : min > 0 && available <= min ? "low" : "ok";
      return { id: p.id, name: p.name, imageV: p.image ? p.image.updatedAt.getTime() : null, symbol: p.baseUnit.symbol, pack: largestPack(p.units.map((u) => ({ symbol: u.unit.symbol, factor: u.factor }))), physical, reserved, available, min, status };
    })
    .sort((a, b) => rank[a.status] - rank[b.status] || a.available - b.available || a.name.localeCompare(b.name));
  const shelfById = new Map(shelf.map((p) => [p.id, p]));
  const moves = moveRows
    .map((r) => ({ product: shelfById.get(r.pid), received: n(r.rin), released: n(r.rout) }))
    .filter((m): m is { product: (typeof shelf)[number]; received: number; released: number } => Boolean(m.product) && m.received + m.released > 0)
    .sort((a, b) => b.received + b.released - (a.received + a.released))
    .slice(0, 8);
  const perDayMap = new Map(perDayRows.map((r) => [r.d, Number(r.q)]));
  const ordersPerDay = Array.from({ length: 14 }, (_, i) => shiftDay(since, i)).map((d) => ({ name: d.slice(8), value: perDayMap.get(d) ?? 0 }));
  const byStatus = [
    { name: "New", value: count("NEW") },
    { name: "Preparing", value: count("PREPARING") },
    { name: "Ready", value: count("READY") },
    { name: "Partly collected", value: count("PARTIAL") },
    { name: "Collected", value: count("COMPLETED") },
    { name: "Cancelled", value: count("CANCELLED") },
  ].filter((x) => x.value > 0);

  return {
    shelf,
    moves,
    ordersPerDay,
    byStatus,
    avgHandoverHours: handover[0]?.h ?? null,
    products: productsHeld,
    physical,
    reserved,
    available: physical - reserved,
    isNew: count("NEW"),
    preparing: count("PREPARING"),
    ready: count("READY"),
    partial: count("PARTIAL"),
    open: count(...OPEN_STATUSES),
    completed: count("COMPLETED"),
    cancelled: count("CANCELLED"),
    collectedToday,
    age,
    oldest,
    days,
    inbound,
    issuesOpen,
    low: alerts.low.length,
    out: alerts.out.length,
    /** products that are out or running low, out first (quantities only, no costs) */
    watch: [...alerts.out.map((a) => ({ ...a, isOut: true })), ...alerts.low.map((a) => ({ ...a, isOut: false }))].slice(0, 8),
    activeProducts: alerts.active,
    inStockProducts: alerts.inStock,
  };
}
export type WarehouseSnapshot = Awaited<ReturnType<typeof getWarehouseSnapshot>>;
