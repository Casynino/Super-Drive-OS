import { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";
import { largestPack, type Pack } from "@/lib/qty";

const D = Prisma.Decimal;

export type StockAlert = { id: string; name: string; qty: string; min: string; symbol: string; imageV: number | null; /** carton size, so the number can be shown in cartons */ pack: Pack | null };

/** Products that are out of stock or at/below their minimum (all locations together). Quantities only, no costs. */
export async function getStockAlerts(db: Pick<Db, "product" | "stockBalance">) {
  const [products, balances] = await Promise.all([
    db.product.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true, minStock: true, baseUnit: { select: { symbol: true } }, units: { select: { factor: true, unit: { select: { symbol: true } } } }, image: { select: { updatedAt: true } } }, orderBy: { name: "asc" } }),
    db.stockBalance.groupBy({ by: ["productId"], where: { location: { type: { not: "RESELLER" } } }, _sum: { quantity: true } }), // stock with resellers is not on the shelf
  ]);
  const qty = new Map(balances.map((b) => [b.productId, b._sum.quantity ?? new D(0)]));
  const out: StockAlert[] = [];
  const low: StockAlert[] = [];
  let inStock = 0;
  for (const p of products) {
    const q = qty.get(p.id) ?? new D(0);
    const row = { id: p.id, name: p.name, qty: q.toString(), min: p.minStock.toString(), symbol: p.baseUnit.symbol, imageV: p.image ? p.image.updatedAt.getTime() : null, pack: largestPack(p.units.map((u) => ({ symbol: u.unit.symbol, factor: u.factor }))) };
    if (q.lte(0)) out.push(row);
    else {
      inStock++;
      if (p.minStock.gt(0) && q.lte(p.minStock)) low.push(row);
    }
  }
  return { out, low, active: products.length, inStock };
}

/**
 * Tells the owner when shelf stock drops to or below its minimum (or runs out) because of what was just done.
 * Fires only when the level CROSSES the line (it was above, now it is at/below), so a busy day does not flood anyone.
 * Stock held by resellers is not on the shelf and is ignored. Call inside the same transaction as the stock change.
 */
export async function notifyStockCrossings(
  tx: Pick<Prisma.TransactionClient, "stockBalance" | "product" | "notification" | "user">,
  removed: { productId: string; qty: Prisma.Decimal }[],
  context: string,
) {
  const merged = new Map<string, Prisma.Decimal>();
  for (const r of removed) merged.set(r.productId, (merged.get(r.productId) ?? new D(0)).plus(r.qty));
  for (const [productId, qty] of merged) {
    const [p, now] = await Promise.all([
      tx.product.findUnique({ where: { id: productId }, select: { name: true, minStock: true, status: true, baseUnit: { select: { symbol: true } } } }),
      tx.stockBalance.aggregate({ where: { productId, location: { type: { not: "RESELLER" } } }, _sum: { quantity: true } }),
    ]);
    if (!p || p.status !== "ACTIVE") continue;
    const after = now._sum.quantity ?? new D(0);
    const before = after.plus(qty);
    const out = after.lte(0) && before.gt(0);
    const low = !out && p.minStock.gt(0) && after.lte(p.minStock) && before.gt(p.minStock);
    if (!out && !low) continue;
    const people = await tx.user.findMany({ where: { status: "ACTIVE", role: { OR: [{ isSuperAdmin: true }, { permissions: { some: { permission: { key: "dashboard.view" } } } }] } }, select: { id: true } });
    if (people.length === 0) continue;
    await tx.notification.createMany({
      data: people.map((u) => ({
        userId: u.id,
        type: out ? "stock.out" : "stock.low",
        title: out ? `${p.name} is out of stock` : `${p.name} is running low: ${after.toString()} ${p.baseUnit.symbol} left`,
        body: context,
        link: "/inventory?status=" + (out ? "out" : "low"),
      })),
    });
  }
}
