// The stock engine. Every change to a stock quantity in the whole system goes through moveStock(),
// which updates the balance and appends the ledger row in the SAME transaction.
//
// Concurrency model (PostgreSQL, READ COMMITTED):
//  - moveStock does ONE atomic UPDATE ... WHERE quantity + delta >= 0. The row lock it takes serialises
//    concurrent writers of that product+location, so two sales can never both take the last bottle.
//  - Anything that reads-then-writes the product's weighted-average cost first locks the Product row
//    (lockProducts). Callers lock products in sorted order, and balances in (productId, locationId) order,
//    so concurrent documents cannot deadlock each other.
import { Prisma, type StockMovementType } from "@/generated/prisma/client";

export type Tx = Prisma.TransactionClient;
const D = Prisma.Decimal;
export type Dec = Prisma.Decimal;

export class InsufficientStockError extends Error {
  constructor(
    public productId: string,
    public locationId: string,
    public available: Dec,
    public requested: Dec,
  ) {
    super(`Insufficient stock: ${available.toString()} available, ${requested.toString()} requested`);
  }
}

const BUSINESS_TZ = "Africa/Dar_es_Salaam";
export const businessYear = (d = new Date()) => Number(new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone: BUSINESS_TZ }).format(d));

/** Atomic, gap-free document numbers per prefix and year, e.g. GRN-2026-000001. Rolls back with the transaction. */
export async function nextDocumentNo(tx: Tx, prefix: string, date = new Date()) {
  const key = `${prefix}-${businessYear(date)}`;
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "DocumentCounter" ("key", "value") VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "DocumentCounter"."value" + 1
    RETURNING "value"`;
  return `${key}-${String(rows[0]!.value).padStart(6, "0")}`;
}

/** Row-locks products (sorted, so concurrent callers queue instead of deadlocking). */
export async function lockProducts(tx: Tx, productIds: string[]) {
  const ids = [...new Set(productIds)].sort();
  if (ids.length === 0) return;
  await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`;
}

/** Ensures the balance row exists, locks it, and returns the current quantity. */
export async function lockBalance(tx: Tx, productId: string, locationId: string): Promise<Dec> {
  await tx.$executeRaw`
    INSERT INTO "StockBalance" ("productId", "locationId", "quantity", "updatedAt")
    VALUES (${productId}, ${locationId}, 0, now())
    ON CONFLICT ("productId", "locationId") DO NOTHING`;
  const rows = await tx.$queryRaw<{ quantity: Prisma.Decimal | string }[]>`
    SELECT "quantity" FROM "StockBalance" WHERE "productId" = ${productId} AND "locationId" = ${locationId} FOR UPDATE`;
  return new D(rows[0]!.quantity.toString());
}

export type MoveInput = {
  productId: string;
  locationId: string;
  type: StockMovementType;
  /** Signed, non-zero, in BASE units. Positive = stock in, negative = stock out. */
  delta: Dec;
  unitCost?: Dec | null;
  referenceType?: string;
  referenceId?: string;
  referenceNo?: string;
  reason?: string | null;
  userId: string;
};

/** Applies one stock change and writes its ledger row. Throws InsufficientStockError instead of going negative. */
export async function moveStock(tx: Tx, m: MoveInput): Promise<{ previousQty: Dec; newQty: Dec }> {
  if (m.delta.isZero() || !m.delta.isFinite()) throw new Error("Stock movement quantity must be non-zero");
  if (m.delta.decimalPlaces() > 3) throw new Error("Stock quantity supports at most 3 decimal places");
  const delta = m.delta.toString();

  await tx.$executeRaw`
    INSERT INTO "StockBalance" ("productId", "locationId", "quantity", "updatedAt")
    VALUES (${m.productId}, ${m.locationId}, 0, now())
    ON CONFLICT ("productId", "locationId") DO NOTHING`;

  const rows = await tx.$queryRaw<{ quantity: Prisma.Decimal | string }[]>`
    UPDATE "StockBalance"
       SET "quantity" = "quantity" + ${delta}::numeric, "updatedAt" = now()
     WHERE "productId" = ${m.productId} AND "locationId" = ${m.locationId}
       AND "quantity" + ${delta}::numeric >= 0
    RETURNING "quantity"`;

  if (rows.length === 0) {
    const bal = await tx.stockBalance.findUnique({ where: { productId_locationId: { productId: m.productId, locationId: m.locationId } } });
    throw new InsufficientStockError(m.productId, m.locationId, bal?.quantity ?? new D(0), m.delta.abs());
  }

  const newQty = new D(rows[0]!.quantity.toString());
  const previousQty = newQty.minus(m.delta);
  await tx.stockMovement.create({
    data: {
      productId: m.productId,
      locationId: m.locationId,
      type: m.type,
      quantity: m.delta,
      previousQty,
      newQty,
      unitCost: m.unitCost ?? null,
      referenceType: m.referenceType,
      referenceId: m.referenceId,
      referenceNo: m.referenceNo,
      reason: m.reason ?? null,
      userId: m.userId,
    },
  });
  return { previousQty, newQty };
}

/** Pure: new weighted-average cost after adding `addQty` units at `addUnitCost` to `onHand` units at `avgCost`. */
export function weightedAverage(onHand: Dec, avgCost: Dec, addQty: Dec, addUnitCost: Dec): Dec {
  if (onHand.lte(0)) return addUnitCost.toDecimalPlaces(4);
  const total = onHand.plus(addQty);
  if (total.lte(0)) return avgCost;
  return onHand.mul(avgCost).plus(addQty.mul(addUnitCost)).div(total).toDecimalPlaces(4);
}

/** Total on hand for a product across all locations. */
export async function totalOnHand(tx: Tx, productId: string): Promise<Dec> {
  const agg = await tx.stockBalance.aggregate({ where: { productId }, _sum: { quantity: true } });
  return agg._sum.quantity ?? new D(0);
}

/**
 * Folds an incoming quantity into the product's weighted-average cost.
 * MUST be called with the product row locked (lockProducts) and BEFORE the quantity itself is moved in.
 */
export async function applyIncomingCost(tx: Tx, productId: string, addQty: Dec, addUnitCost: Dec) {
  const product = await tx.product.findUniqueOrThrow({ where: { id: productId }, select: { avgCost: true } });
  const onHand = await totalOnHand(tx, productId);
  const next = weightedAverage(onHand, product.avgCost, addQty, addUnitCost);
  if (!next.eq(product.avgCost)) await tx.product.update({ where: { id: productId }, data: { avgCost: next } });
  return next;
}
