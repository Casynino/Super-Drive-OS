// Individual items: every physical piece of a product (bottle, gallon, box) gets its own identity when it is received,
// and every change to it (sold, damaged, issued, returned ...) is a recorded movement. Call inside db.$transaction.
//
// How it stays true to the stock numbers: StockBalance is still the count (moveStock). The item layer follows it.
//   - Stock coming in (receipt, found stock) creates that many new items.
//   - Stock going out takes items. Pieces that were scanned are taken first; the rest comes from stock that has no
//     item yet (older stock from before items existed), and only then from the oldest pieces in that location
//     (flagged "auto": the sale was by quantity, so the piece was not scanned).
//   - A transfer moves items to the new location; a customer return puts the sold items back.
// Items in a location can therefore never be more than the balance there.
//
// Items exist only for products whose base unit is a whole number. Nothing here is ever deleted, and an item's
// status or place cannot change without a movement row (the database enforces it).
import { randomBytes, randomUUID } from "node:crypto";
import { Prisma, type ItemEventKind, type ItemStatus, type StockMovementType } from "@/generated/prisma/client";
import { parseItemCode } from "@/lib/item-code";
import { lockBalance, moveStock, type Dec, type MoveInput, type Tx } from "./engine";

export { parseItemCode };

export type ItemErrorCode = "NOT_FOUND" | "SOLD" | "WITH_RESELLER" | "WRONG_LOCATION" | "WRONG_PRODUCT" | "NOT_AVAILABLE" | "DUPLICATE";

/** A problem with a scanned item the person can understand ("This product has already been sold."). */
export class ItemError extends Error {
  constructor(
    message: string,
    public code: ItemErrorCode,
  ) {
    super(message);
  }
}

const PRESENT: ItemStatus[] = ["AVAILABLE", "WITH_RESELLER"]; // an item that is physically in a location
const CHUNK = 1000;

// ───────────── Identity ─────────────

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I: easy to read and to type

/** A random, non-guessable reference (80 bits). It carries no business information. */
export function newToken(): string {
  const bytes = randomBytes(16);
  let out = "";
  for (let i = 0; i < 16; i++) out += ALPHABET[bytes[i]! % 32];
  return out;
}

export const formatItemNo = (n: number) => `SDO-ITEM-${String(n).padStart(6, "0")}`;

/** Reserves n consecutive item numbers (gap-free, rolled back with the transaction) and returns the first. */
async function reserveItemNumbers(tx: Tx, n: number): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "DocumentCounter" ("key", "value") VALUES ('ITEM', ${n})
    ON CONFLICT ("key") DO UPDATE SET "value" = "DocumentCounter"."value" + ${n}
    RETURNING "value"`;
  return rows[0]!.value - n + 1;
}

/** True when this product is tracked piece by piece (its base unit is a whole number). */
export async function isTracked(tx: Pick<Tx, "product">, productId: string): Promise<boolean> {
  const p = await tx.product.findUnique({ where: { id: productId }, select: { baseUnit: { select: { allowsDecimal: true } } } });
  return Boolean(p) && !p!.baseUnit.allowsDecimal;
}

const whole = (q: Dec): number => {
  const n = q.abs().toNumber();
  if (!Number.isInteger(n)) throw new Error("Tracked items need a whole quantity");
  return n;
};

type Refs = { referenceType?: string; referenceId?: string; referenceNo?: string; note?: string | null; userId: string };

async function locationType(tx: Tx, id: string) {
  return (await tx.location.findUniqueOrThrow({ where: { id }, select: { type: true } })).type;
}

// ───────────── Creating items (stock coming in) ─────────────

/** Gives every newly arrived piece its own number and token. All or nothing: a failure leaves no items and no gap in the numbers. */
export async function createItems(tx: Tx, i: { productId: string; locationId: string; qty: Dec; kind: "RECEIVED" | "ADDED"; receiptId?: string | null; shipmentId?: string | null } & Refs): Promise<number> {
  const n = whole(i.qty);
  if (n <= 0) return 0;
  const status: ItemStatus = (await locationType(tx, i.locationId)) === "RESELLER" ? "WITH_RESELLER" : "AVAILABLE";
  const now = new Date();
  for (let done = 0; done < n; done += CHUNK) {
    const m = Math.min(CHUNK, n - done);
    const first = await reserveItemNumbers(tx, m);
    const rows = Array.from({ length: m }, (_, k) => ({ id: randomUUID(), movementId: randomUUID(), no: first + k, token: newToken() }));
    await tx.inventoryItem.createMany({
      data: rows.map((r) => ({
        id: r.id,
        itemNo: formatItemNo(r.no),
        token: r.token,
        productId: i.productId,
        locationId: i.locationId,
        status,
        receivedAt: now,
        receiptId: i.receiptId ?? null,
        shipmentId: i.shipmentId ?? null,
        lastMovementId: r.movementId,
      })),
    });
    await tx.itemMovement.createMany({
      data: rows.map((r) => ({
        id: r.movementId,
        itemId: r.id,
        kind: i.kind,
        fromStatus: null,
        toStatus: status,
        fromLocationId: null,
        toLocationId: i.locationId,
        referenceType: i.referenceType ?? null,
        referenceId: i.referenceId ?? null,
        referenceNo: i.referenceNo ?? null,
        note: i.note ?? null,
        userId: i.userId,
      })),
    });
  }
  return n;
}

// ───────────── Moving items ─────────────

type Row = { id: string; status: ItemStatus; locationId: string };

/** Writes one movement per item and updates the items to match. The movement is created first; the item points at it. */
async function transition(
  tx: Tx,
  rows: Row[],
  t: { kind: ItemEventKind; toStatus: ItemStatus; toLocationId?: string; saleId?: string | null; saleItemId?: string | null; auto: boolean } & Refs,
) {
  for (let at = 0; at < rows.length; at += CHUNK) {
    const part = rows.slice(at, at + CHUNK);
    const mids = part.map(() => randomUUID());
    await tx.itemMovement.createMany({
      data: part.map((r, k) => ({
        id: mids[k]!,
        itemId: r.id,
        kind: t.kind,
        fromStatus: r.status,
        toStatus: t.toStatus,
        fromLocationId: r.locationId,
        toLocationId: t.toLocationId ?? r.locationId,
        referenceType: t.referenceType ?? null,
        referenceId: t.referenceId ?? null,
        referenceNo: t.referenceNo ?? null,
        note: t.note ?? null,
        auto: t.auto,
        userId: t.userId,
      })),
    });
    const ids = part.map((r) => r.id);
    await tx.$executeRaw`
      UPDATE "InventoryItem" i
         SET "status" = ${t.toStatus}::"ItemStatus",
             "locationId" = COALESCE(${t.toLocationId ?? null}::text, i."locationId"),
             "saleId" = COALESCE(${t.saleId ?? null}::text, i."saleId"),
             "saleItemId" = COALESCE(${t.saleItemId ?? null}::text, i."saleItemId"),
             "lastMovementId" = v.mid,
             "updatedAt" = now()
        FROM unnest(${ids}::text[], ${mids}::text[]) AS v(id, mid)
       WHERE i."id" = v.id`;
  }
}

/** The oldest pieces present in a location, locked. Pieces another sale is working on are skipped so two sales never take the same piece. */
async function pickOldest(tx: Tx, productId: string, locationId: string, limit: number, exclude: string[]): Promise<Row[]> {
  if (limit <= 0) return [];
  const notIn = exclude.length ? Prisma.sql`AND "id" <> ALL(${exclude}::text[])` : Prisma.empty;
  const query = (lock: Prisma.Sql, n: number) =>
    tx.$queryRaw<Row[]>`
      SELECT "id", "status", "locationId" FROM "InventoryItem"
       WHERE "productId" = ${productId} AND "locationId" = ${locationId} AND "status" = ANY(${PRESENT}::"ItemStatus"[]) ${notIn}
       ORDER BY "receivedAt" ASC, "itemNo" ASC LIMIT ${n} ${lock}`;
  const got = await query(Prisma.sql`FOR UPDATE SKIP LOCKED`, limit);
  if (got.length >= limit) return got;
  // some were busy: wait for them rather than come up short
  const more = await tx.$queryRaw<Row[]>`
    SELECT "id", "status", "locationId" FROM "InventoryItem"
     WHERE "productId" = ${productId} AND "locationId" = ${locationId} AND "status" = ANY(${PRESENT}::"ItemStatus"[]) ${notIn} AND "id" <> ALL(${got.map((g) => g.id)}::text[])
     ORDER BY "receivedAt" ASC, "itemNo" ASC LIMIT ${limit - got.length} FOR UPDATE`;
  return [...got, ...more];
}

const presentCount = (tx: Tx, productId: string, locationId: string) => tx.inventoryItem.count({ where: { productId, locationId, status: { in: PRESENT } } });

/** Locks the scanned items and checks each one can really be used here. Throws a plain-language ItemError otherwise. */
async function lockScanned(tx: Tx, ids: string[], productId: string, locationId: string): Promise<Row[]> {
  if (ids.length === 0) return [];
  if (new Set(ids).size !== ids.length) throw new ItemError("The same item was scanned twice.", "DUPLICATE");
  const rows = await tx.$queryRaw<(Row & { productId: string; itemNo: string })[]>`
    SELECT "id", "status", "locationId", "productId", "itemNo" FROM "InventoryItem" WHERE "id" = ANY(${ids}::text[]) ORDER BY "id" FOR UPDATE`;
  if (rows.length !== ids.length) throw new ItemError("This item was not found.", "NOT_FOUND");
  for (const r of rows) {
    if (r.productId !== productId) throw new ItemError(`${r.itemNo} belongs to a different product.`, "WRONG_PRODUCT");
    if (r.status === "SOLD") throw new ItemError("This product has already been sold.", "SOLD");
    if (r.status === "WITH_RESELLER" && r.locationId !== locationId) throw new ItemError("This product is currently assigned to a winga.", "WITH_RESELLER");
    if (r.locationId !== locationId) throw new ItemError("This product is not available at this location.", "WRONG_LOCATION");
    if (r.status !== "AVAILABLE" && r.status !== "WITH_RESELLER") throw new ItemError(`This item cannot be used: it is ${r.status.toLowerCase().replace("_", " ")}.`, "NOT_AVAILABLE");
  }
  return rows.map(({ id, status, locationId: l }) => ({ id, status, locationId: l }));
}

/**
 * Stock going out: takes `qty` pieces. Scanned pieces first, then stock that has no item yet, then the oldest pieces
 * (marked auto). `previousQty` is the location's balance BEFORE this move (from moveStock).
 */
export async function takeItems(
  tx: Tx,
  i: { productId: string; locationId: string; qty: Dec; previousQty: Dec; kind: ItemEventKind; toStatus: ItemStatus; itemIds?: string[]; saleId?: string | null; saleItemId?: string | null } & Refs,
): Promise<string[]> {
  const n = whole(i.qty);
  const scanned = await lockScanned(tx, i.itemIds ?? [], i.productId, i.locationId);
  if (scanned.length > n) throw new ItemError("More items were scanned than the quantity.", "DUPLICATE");

  const present = await presentCount(tx, i.productId, i.locationId);
  const untracked = Math.max(i.previousQty.toNumber() - present, 0); // stock with no item yet
  const remaining = n - scanned.length;
  const auto = await pickOldest(tx, i.productId, i.locationId, remaining - Math.min(remaining, untracked), scanned.map((s) => s.id));

  const t = { kind: i.kind, toStatus: i.toStatus, saleId: i.saleId, saleItemId: i.saleItemId, referenceType: i.referenceType, referenceId: i.referenceId, referenceNo: i.referenceNo, note: i.note, userId: i.userId };
  if (scanned.length) await transition(tx, scanned, { ...t, auto: false });
  if (auto.length) await transition(tx, auto, { ...t, auto: true });
  return [...scanned, ...auto].map((r) => r.id);
}

/** A customer returned goods: the pieces that were sold on that sale line go back into the location (or straight to damaged). */
export async function returnSoldItems(tx: Tx, i: { productId: string; locationId: string; qty: Dec; saleItemId: string } & Refs): Promise<string[]> {
  const n = whole(i.qty);
  const rows = await tx.$queryRaw<Row[]>`
    SELECT "id", "status", "locationId" FROM "InventoryItem"
     WHERE "saleItemId" = ${i.saleItemId} AND "productId" = ${i.productId} AND "status" = 'SOLD'
     ORDER BY "itemNo" ASC LIMIT ${n} FOR UPDATE`;
  if (rows.length === 0) return [];
  const toStatus: ItemStatus = (await locationType(tx, i.locationId)) === "RESELLER" ? "WITH_RESELLER" : "AVAILABLE";
  await transition(tx, rows, { kind: "RETURNED", toStatus, toLocationId: i.locationId, auto: false, referenceType: i.referenceType, referenceId: i.referenceId, referenceNo: i.referenceNo, note: i.note, userId: i.userId });
  return rows.map((r) => r.id);
}

/** A transfer between locations: pieces follow the stock (stock without an item moves on its own). Issuing to a reseller makes them WITH_RESELLER; coming back makes them AVAILABLE. */
export async function transferItems(tx: Tx, i: { productId: string; fromLocationId: string; toLocationId: string; qty: Dec; previousQtyFrom: Dec; itemIds?: string[] } & Refs): Promise<string[]> {
  const n = whole(i.qty);
  const scanned = await lockScanned(tx, i.itemIds ?? [], i.productId, i.fromLocationId);
  const present = await presentCount(tx, i.productId, i.fromLocationId);
  const untracked = Math.max(i.previousQtyFrom.toNumber() - present, 0);
  const remaining = n - scanned.length;
  const auto = await pickOldest(tx, i.productId, i.fromLocationId, remaining - Math.min(remaining, untracked), scanned.map((s) => s.id));
  const [fromType, toType] = await Promise.all([locationType(tx, i.fromLocationId), locationType(tx, i.toLocationId)]);
  const toStatus: ItemStatus = toType === "RESELLER" ? "WITH_RESELLER" : "AVAILABLE";
  const kind: ItemEventKind = toType === "RESELLER" ? "ISSUED_TO_RESELLER" : fromType === "RESELLER" ? "RETURNED_FROM_RESELLER" : "TRANSFERRED";
  const t = { kind, toStatus, toLocationId: i.toLocationId, referenceType: i.referenceType, referenceId: i.referenceId, referenceNo: i.referenceNo, note: i.note, userId: i.userId };
  if (scanned.length) await transition(tx, scanned, { ...t, auto: false });
  if (auto.length) await transition(tx, auto, { ...t, auto: true });
  return [...scanned, ...auto].map((r) => r.id);
}

// ───────────── One call for stock + items ─────────────

export type ItemCtx = {
  /** pieces that were scanned for this movement */
  itemIds?: string[];
  saleId?: string | null;
  saleItemId?: string | null;
  receiptId?: string | null;
  shipmentId?: string | null;
  note?: string | null;
};

/**
 * moveStock + the item layer in one call. Transfers are not handled here (they have two legs): postTransfer calls transferItems.
 * Returns the ids of the items that were created or moved.
 */
export async function moveStockTracked(tx: Tx, m: MoveInput, ctx: ItemCtx = {}): Promise<{ previousQty: Dec; newQty: Dec; itemIds: string[] }> {
  const r = await moveStock(tx, m);
  if (!(await isTracked(tx, m.productId))) return { ...r, itemIds: [] };

  const qty = m.delta.abs();
  const refs: Refs = { referenceType: m.referenceType, referenceId: m.referenceId, referenceNo: m.referenceNo, note: ctx.note ?? m.reason ?? null, userId: m.userId };
  const type: StockMovementType = m.type;
  let itemIds: string[] = [];

  if (m.delta.gt(0)) {
    if (type === "RECEIVED") await createItems(tx, { productId: m.productId, locationId: m.locationId, qty, kind: "RECEIVED", receiptId: ctx.receiptId, shipmentId: ctx.shipmentId, ...refs });
    else if (type === "ADJUSTMENT" || type === "CORRECTION") await createItems(tx, { productId: m.productId, locationId: m.locationId, qty, kind: "ADDED", ...refs });
    else if (type === "CUSTOMER_RETURN" && ctx.saleItemId) itemIds = await returnSoldItems(tx, { productId: m.productId, locationId: m.locationId, qty, saleItemId: ctx.saleItemId, ...refs });
  } else {
    const common = { productId: m.productId, locationId: m.locationId, qty, previousQty: r.previousQty, itemIds: ctx.itemIds, saleId: ctx.saleId, saleItemId: ctx.saleItemId, ...refs };
    if (type === "SOLD") {
      const kind: ItemEventKind = (await locationType(tx, m.locationId)) === "RESELLER" ? "SOLD_BY_RESELLER" : "SOLD";
      itemIds = await takeItems(tx, { ...common, kind, toStatus: "SOLD" });
    } else if (type === "DAMAGED") itemIds = await takeItems(tx, { ...common, kind: "DAMAGED", toStatus: "DAMAGED" });
    else if (type === "ADJUSTMENT" || type === "CORRECTION") itemIds = await takeItems(tx, { ...common, kind: "MISSING", toStatus: "MISSING" });
  }
  return { ...r, itemIds };
}

// ───────────── Damaged pieces thrown away ─────────────

/**
 * The owner decided that pieces which arrived damaged cannot be sold: they are marked DISPOSED for good.
 * No stock changes (damaged pieces were already taken off the shelf count when they were counted in); this only records what happened to the pieces.
 * Returns how many pieces were marked (products that are not tracked piece by piece have none).
 */
export async function disposeDamagedItems(tx: Tx, i: { shipmentId: string; productId: string; qty: Dec } & Refs): Promise<number> {
  if (!(await isTracked(tx, i.productId))) return 0;
  const n = whole(i.qty);
  const rows = await tx.$queryRaw<Row[]>`
    SELECT "id", "status", "locationId" FROM "InventoryItem"
     WHERE "shipmentId" = ${i.shipmentId} AND "productId" = ${i.productId} AND "status" = 'DAMAGED'
     ORDER BY "itemNo" DESC LIMIT ${n} FOR UPDATE`;
  if (rows.length) await transition(tx, rows, { kind: "DISPOSED", toStatus: "DISPOSED", auto: false, referenceType: i.referenceType, referenceId: i.referenceId, referenceNo: i.referenceNo, note: i.note, userId: i.userId });
  return rows.length;
}

/**
 * Same as disposeDamagedItems, for a problem reported by hand: the pieces that went DAMAGED because of that stock adjustment are marked DISPOSED.
 * (Lost pieces stay MISSING: nothing to throw away.) No stock changes.
 */
export async function disposeReportedItems(tx: Tx, i: { adjustmentId: string; productId: string; qty: Dec } & Refs): Promise<number> {
  if (!(await isTracked(tx, i.productId))) return 0;
  const n = whole(i.qty);
  const rows = await tx.$queryRaw<Row[]>`
    SELECT it."id", it."status", it."locationId" FROM "InventoryItem" it
     WHERE it."productId" = ${i.productId} AND it."status" = 'DAMAGED'
       AND EXISTS (SELECT 1 FROM "ItemMovement" m WHERE m."itemId" = it."id" AND m."toStatus" = 'DAMAGED' AND m."referenceType" = 'StockAdjustment' AND m."referenceId" = ${i.adjustmentId})
     ORDER BY it."itemNo" DESC LIMIT ${n} FOR UPDATE OF it`;
  if (rows.length) await transition(tx, rows, { kind: "DISPOSED", toStatus: "DISPOSED", auto: false, referenceType: i.referenceType, referenceId: i.referenceId, referenceNo: i.referenceNo, note: i.note, userId: i.userId });
  return rows.length;
}

// ───────────── Looking items up ─────────────

/** Turns scanned codes into item ids (same order). An unknown or mistyped code is a plain ItemError. */
export async function resolveItemCodes(tx: Tx, codes: string[]): Promise<string[]> {
  if (codes.length === 0) return [];
  const keys = codes.map((c) => ({ raw: c, key: parseItemCode(c) }));
  const bad = keys.find((k) => !k.key);
  if (bad) throw new ItemError(`"${bad.raw}" is not an item code.`, "NOT_FOUND");
  const tokens = keys.flatMap((k) => (k.key!.token ? [k.key!.token] : []));
  const nos = keys.flatMap((k) => (k.key!.itemNo ? [k.key!.itemNo] : []));
  const found = await tx.inventoryItem.findMany({ where: { OR: [{ token: { in: tokens } }, { itemNo: { in: nos } }] }, select: { id: true, token: true, itemNo: true } });
  return keys.map((k) => {
    const hit = found.find((f) => (k.key!.token ? f.token === k.key!.token : f.itemNo === k.key!.itemNo));
    if (!hit) throw new ItemError("This item was not found. Check the label and scan again.", "NOT_FOUND");
    return hit.id;
  });
}

export async function findItemByCode(db: Pick<Tx, "inventoryItem">, raw: string) {
  const key = parseItemCode(raw);
  if (!key) return null;
  return db.inventoryItem.findUnique({ where: key.token ? { token: key.token } : { itemNo: key.itemNo! } });
}

// ───────────── Stock that has no items yet ─────────────

/** Where the shelf holds more pieces than there are items (stock received before items existed). */
export async function untrackedStock(db: Pick<Tx, "$queryRaw">): Promise<{ productId: string; locationId: string; missing: number }[]> {
  return db.$queryRaw`
    SELECT b."productId", b."locationId", (b."quantity" - COALESCE(i.cnt, 0))::int AS "missing"
      FROM "StockBalance" b
      JOIN "Product" p ON p."id" = b."productId"
      JOIN "Unit" u ON u."id" = p."baseUnitId" AND u."allowsDecimal" = false
      LEFT JOIN (SELECT "productId", "locationId", count(*) AS cnt FROM "InventoryItem" WHERE "status" IN ('AVAILABLE', 'WITH_RESELLER') GROUP BY 1, 2) i
        ON i."productId" = b."productId" AND i."locationId" = b."locationId"
     WHERE b."quantity" > COALESCE(i.cnt, 0)`;
}

/** Gives every piece of existing stock its own number and QR (once; running it again finds nothing left to do). Returns how many items were made. */
export async function labelExistingStock(tx: Tx, userId: string): Promise<number> {
  let made = 0;
  for (const r of (await untrackedStock(tx)).sort((a, b) => a.productId.localeCompare(b.productId) || a.locationId.localeCompare(b.locationId))) {
    await lockBalance(tx, r.productId, r.locationId); // no sale can change the count while its pieces are numbered
    const again = (await untrackedStock(tx)).find((x) => x.productId === r.productId && x.locationId === r.locationId);
    if (!again) continue;
    made += await createItems(tx, { productId: r.productId, locationId: r.locationId, qty: new Prisma.Decimal(again.missing), kind: "ADDED", note: "Existing stock given item numbers", referenceType: "Backfill", userId });
  }
  return made;
}
