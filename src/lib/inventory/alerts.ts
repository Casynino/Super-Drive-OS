import { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";

const D = Prisma.Decimal;

export type StockAlert = { id: string; name: string; qty: string; min: string; symbol: string; imageV: number | null };

/** Products that are out of stock or at/below their minimum (all locations together). Quantities only, no costs. */
export async function getStockAlerts(db: Pick<Db, "product" | "stockBalance">) {
  const [products, balances] = await Promise.all([
    db.product.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true, minStock: true, baseUnit: { select: { symbol: true } }, image: { select: { updatedAt: true } } }, orderBy: { name: "asc" } }),
    db.stockBalance.groupBy({ by: ["productId"], _sum: { quantity: true } }),
  ]);
  const qty = new Map(balances.map((b) => [b.productId, b._sum.quantity ?? new D(0)]));
  const out: StockAlert[] = [];
  const low: StockAlert[] = [];
  let inStock = 0;
  for (const p of products) {
    const q = qty.get(p.id) ?? new D(0);
    const row = { id: p.id, name: p.name, qty: q.toString(), min: p.minStock.toString(), symbol: p.baseUnit.symbol, imageV: p.image ? p.image.updatedAt.getTime() : null };
    if (q.lte(0)) out.push(row);
    else {
      inStock++;
      if (p.minStock.gt(0) && q.lte(p.minStock)) low.push(row);
    }
  }
  return { out, low, active: products.length, inStock };
}
