import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { postAdjustment, postReceipt, postTransfer } from "./documents";
import { itemQrText } from "@/lib/qr";
import { formatItemNo, moveStockTracked, newToken, parseItemCode } from "./items";
import { resolveLines } from "./lines";
import { SaleError, postSale, type SaleInput } from "@/lib/sales/post-sale";

const D = (v: string | number) => new Prisma.Decimal(v);
let userId: string;
let piece: string;
let litre: string;
let categoryId: string;

beforeAll(async () => {
  const role = await db.role.create({ data: { key: `T_${randomUUID()}`, name: "Test role" } });
  userId = (await db.user.create({ data: { username: `t_${randomUUID()}`, name: "Attendant", passwordHash: "x", roleId: role.id } })).id;
  piece = (await db.unit.create({ data: { name: `Piece ${randomUUID()}`, symbol: randomUUID().slice(0, 8) } })).id;
  litre = (await db.unit.create({ data: { name: `Litre ${randomUUID()}`, symbol: randomUUID().slice(0, 8), allowsDecimal: true } })).id;
  categoryId = (await db.category.create({ data: { name: `Cat ${randomUUID()}` } })).id;
});

const loc = (type: "SHOP" | "RESELLER" = "SHOP") => db.location.create({ data: { code: randomUUID().slice(0, 8).toUpperCase(), name: `Loc ${randomUUID()}`, type } });
const product = (baseUnitId = piece) => db.product.create({ data: { sku: `SKU-${randomUUID()}`, name: "Test gallon", categoryId, baseUnitId, purchasePrice: 10000, sellingPrice: 25000 } });

/** Receive n pieces as one receipt (opening stock). */
async function receive(productId: string, locationId: string, n: number, shipmentId?: string) {
  return db.$transaction(
    async (tx) => {
      const r = await resolveLines(tx, [{ productId, unitId: (await tx.product.findUniqueOrThrow({ where: { id: productId } })).baseUnitId, quantity: String(n) }]);
      if (!r.ok) throw new Error(r.message);
      return postReceipt(tx, { type: "OPENING_STOCK", supplierId: null, locationId, supplierInvoice: null, receivedDate: new Date(), notes: null, submissionKey: randomUUID(), lines: r.lines.map((l) => ({ ...l, lineTotal: D(n * 10000) })), user: { id: userId }, shipmentId });
    },
    { timeout: 60000 },
  );
}

const items = (productId: string, where: Prisma.InventoryItemWhereInput = {}) => db.inventoryItem.findMany({ where: { productId, ...where }, orderBy: { itemNo: "asc" } });
const balance = async (productId: string, locationId: string) => (await db.stockBalance.findUnique({ where: { productId_locationId: { productId, locationId } } }))?.quantity ?? D(0);
const present = (productId: string, locationId: string) => db.inventoryItem.count({ where: { productId, locationId, status: { in: ["AVAILABLE", "WITH_RESELLER"] } } });

function sellInput(location: { id: string }, lines: SaleInput["lines"]): SaleInput {
  return { user: { id: userId }, can: { discount: false, credit: true, approveCreditException: false }, customerId: null, locationId: location.id, mode: "FULL", method: "CASH", partAmount: null, reference: null, notes: null, lines, creditException: null, submissionKey: randomUUID(), currencyDecimals: 0, creditTermsDays: 30 };
}
const sell = (location: { id: string }, productId: string, quantity: string, itemCodes?: string[]) => db.$transaction((tx) => postSale(tx, sellInput(location, [{ productId, unitId: piece, quantity, unitPrice: "", itemCodes }])));

describe("receiving creates one identity per piece", () => {
  it("100 pieces become 100 items with unique numbers and tokens, all available at the receiving location", async () => {
    const l = await loc();
    const p = await product();
    await receive(p.id, l.id, 100);
    const all = await items(p.id);
    expect(all).toHaveLength(100);
    expect(new Set(all.map((i) => i.itemNo)).size).toBe(100);
    expect(new Set(all.map((i) => i.token)).size).toBe(100);
    for (const i of all) {
      expect(i.itemNo).toMatch(/^SDO-ITEM-\d{6,}$/);
      expect(i.token).toMatch(/^[A-HJ-NP-Z2-9]{16}$/);
      expect([i.status, i.locationId]).toEqual(["AVAILABLE", l.id]);
    }
    // numbers are consecutive (no gaps) and each piece has exactly one RECEIVED movement
    const nums = all.map((i) => Number(i.itemNo.slice(9)));
    expect(nums[99]! - nums[0]!).toBe(99);
    expect(await db.itemMovement.count({ where: { itemId: { in: all.map((i) => i.id) }, kind: "RECEIVED" } })).toBe(100);
    expect(await balance(p.id, l.id)).toEqual(D(100));
  });

  it("partial receiving never repeats an identity: 60 then 40 gives 100 distinct pieces", async () => {
    const l = await loc();
    const p = await product();
    await receive(p.id, l.id, 60);
    const first = await items(p.id);
    await receive(p.id, l.id, 40);
    const all = await items(p.id);
    expect(all).toHaveLength(100);
    expect(new Set(all.map((i) => i.itemNo)).size).toBe(100);
    expect(new Set(all.map((i) => i.token)).size).toBe(100);
    expect(all.slice(0, 60).map((i) => i.id)).toEqual(first.map((i) => i.id)); // the first 60 are untouched
  });

  it("a failed receipt leaves no items and no gap in the numbers", async () => {
    const l = await loc();
    const p = await product();
    await receive(p.id, l.id, 3);
    const before = await db.documentCounter.findUniqueOrThrow({ where: { key: "ITEM" } });
    const sub = randomUUID();
    const bad = () =>
      db.$transaction(async (tx) => {
        const r = await resolveLines(tx, [{ productId: p.id, unitId: piece, quantity: "5" }]);
        if (!r.ok) throw new Error(r.message);
        await postReceipt(tx, { type: "OPENING_STOCK", supplierId: null, locationId: l.id, supplierInvoice: null, receivedDate: new Date(), notes: null, submissionKey: sub, lines: r.lines.map((x) => ({ ...x, lineTotal: D(5) })), user: { id: userId } });
        throw new Error("boom"); // everything above must roll back
      });
    await expect(bad()).rejects.toThrow("boom");
    expect(await items(p.id)).toHaveLength(3);
    expect((await db.documentCounter.findUniqueOrThrow({ where: { key: "ITEM" } })).value).toBe(before.value);
  });

  it("products counted in litres (fractions allowed) are not tracked piece by piece", async () => {
    const l = await loc();
    const p = await product(litre);
    await receive(p.id, l.id, 20);
    expect(await items(p.id)).toHaveLength(0);
    expect(await balance(p.id, l.id)).toEqual(D(20));
  });

  it("a shipment's pieces remember the shipment and the receipt they arrived in", async () => {
    const l = await loc();
    const p = await product();
    const owner = userId;
    const s = await db.shipment.create({ data: { shipmentNo: `SHP-T-${randomUUID().slice(0, 8)}`, locationId: l.id, createdById: owner, submissionKey: randomUUID() } });
    const receipt = await receive(p.id, l.id, 4, s.id);
    const all = await items(p.id);
    expect(all.every((i) => i.shipmentId === s.id && i.receiptId === receipt.id)).toBe(true);
  });
});

describe("scan to sell", () => {
  it("scanning marks exactly those pieces sold, links them to the invoice line, and a second sale of the same piece is refused", async () => {
    const l = await loc();
    const p = await product();
    await receive(p.id, l.id, 10);
    const all = await items(p.id);
    const a = all[7]!;
    const b = all[3]!;
    const { sale } = await sell(l, p.id, "2", [`SDOI:${a.token}`, b.itemNo]); // by QR text and by item number
    const after = await items(p.id, { id: { in: [a.id, b.id] } });
    expect(after.map((i) => i.status)).toEqual(["SOLD", "SOLD"]);
    const line = await db.saleItem.findFirstOrThrow({ where: { saleId: sale.id } });
    expect(after.every((i) => i.saleId === sale.id && i.saleItemId === line.id)).toBe(true);
    const mv = await db.itemMovement.findMany({ where: { itemId: a.id }, orderBy: { createdAt: "asc" } });
    expect(mv.map((m) => [m.kind, m.auto, m.referenceNo])).toEqual([["RECEIVED", false, expect.any(String)], ["SOLD", false, sale.saleNo]]);
    expect(await balance(p.id, l.id)).toEqual(D(8));

    // the same piece again: refused, with the plain message, and nothing else changes
    await expect(sell(l, p.id, "1", [a.token])).rejects.toThrow("This product has already been sold.");
    expect(await balance(p.id, l.id)).toEqual(D(8));
    expect(await present(p.id, l.id)).toBe(8);
  });

  it("an item from another location, a reseller's item and an unknown code are refused with clear messages", async () => {
    const shop = await loc();
    const other = await loc();
    const custody = await loc("RESELLER");
    const p = await product();
    await receive(p.id, shop.id, 3);
    await receive(p.id, other.id, 2);
    const elsewhere = (await items(p.id, { locationId: other.id }))[0]!;
    await expect(sell(shop, p.id, "1", [elsewhere.token])).rejects.toThrow("This product is not available at this location.");

    const toReseller = await db.$transaction(async (tx) => {
      const r = await resolveLines(tx, [{ productId: p.id, unitId: piece, quantity: "1" }]);
      if (!r.ok) throw new Error(r.message);
      return postTransfer(tx, { fromLocationId: shop.id, toLocationId: custody.id, notes: null, submissionKey: randomUUID(), lines: r.lines, user: { id: userId } });
    });
    expect(toReseller.transferNo).toBeTruthy();
    const issued = (await items(p.id, { status: "WITH_RESELLER" }))[0]!;
    expect(issued.locationId).toBe(custody.id);
    await expect(sell(shop, p.id, "1", [issued.token])).rejects.toThrow("This product is currently assigned to a reseller.");
    await expect(sell(shop, p.id, "1", ["SDO-ITEM-999999"])).rejects.toThrow(/not found/);
    await expect(sell(shop, p.id, "1", ["not a code"])).rejects.toThrow(/not an item code/);
    expect(await balance(p.id, shop.id)).toEqual(D(2)); // nothing was sold
  });

  it("scanned pieces must belong to the line's product, and cannot be scanned twice in one sale", async () => {
    const l = await loc();
    const p1 = await product();
    const p2 = await product();
    await receive(p1.id, l.id, 3);
    await receive(p2.id, l.id, 3);
    const other = (await items(p2.id))[0]!;
    await expect(sell(l, p1.id, "1", [other.token])).rejects.toBeInstanceOf(SaleError);
    const mine = (await items(p1.id))[0]!;
    await expect(sell(l, p1.id, "2", [mine.token, mine.itemNo])).rejects.toThrow(/twice/);
  });

  it("two cashiers scanning the same piece at the same moment: exactly one sale goes through", async () => {
    const l = await loc();
    const p = await product();
    await receive(p.id, l.id, 5);
    const target = (await items(p.id))[0]!;
    const results = await Promise.allSettled([sell(l, p.id, "1", [target.token]), sell(l, p.id, "1", [target.token])]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await balance(p.id, l.id)).toEqual(D(4));
    expect(await db.itemMovement.count({ where: { itemId: target.id, kind: "SOLD" } })).toBe(1);
  });
});

describe("selling by quantity keeps working", () => {
  it("takes the oldest pieces (flagged auto), and the item count never exceeds the stock", async () => {
    const l = await loc();
    const p = await product();
    await receive(p.id, l.id, 10);
    await sell(l, p.id, "3");
    const sold = await items(p.id, { status: "SOLD" });
    expect(sold).toHaveLength(3);
    const first3 = (await items(p.id)).slice(0, 3).map((i) => i.id);
    expect(sold.map((i) => i.id)).toEqual(first3);
    const mv = await db.itemMovement.findMany({ where: { itemId: { in: first3 }, kind: "SOLD" } });
    expect(mv.every((m) => m.auto)).toBe(true);
    expect(await present(p.id, l.id)).toBe(7);
    expect(await balance(p.id, l.id)).toEqual(D(7));
  });

  it("stock that has no items yet (from before items existed) is used first", async () => {
    const l = await loc();
    const p = await product();
    // 5 pieces of old stock with no items: put them straight on the shelf
    await db.stockBalance.create({ data: { productId: p.id, locationId: l.id, quantity: 5 } });
    await receive(p.id, l.id, 4); // 4 new pieces with items; shelf = 9
    await sell(l, p.id, "3"); // comes from the 5 old pieces
    expect(await items(p.id, { status: "SOLD" })).toHaveLength(0);
    await sell(l, p.id, "4"); // 2 old pieces left, then 2 items
    expect(await items(p.id, { status: "SOLD" })).toHaveLength(2);
    expect(await balance(p.id, l.id)).toEqual(D(2));
    expect(await present(p.id, l.id)).toBe(2);
  });

  it("not enough stock is still refused and nothing changes", async () => {
    const l = await loc();
    const p = await product();
    await receive(p.id, l.id, 2);
    await expect(sell(l, p.id, "3")).rejects.toThrow();
    expect(await present(p.id, l.id)).toBe(2);
  });
});

describe("damage, losses, found stock, transfers, returns", () => {
  const adjust = (l: { id: string }, productId: string, kind: "INCREASE" | "DECREASE" | "DAMAGE" | "COUNT", n: number) =>
    db.$transaction(async (tx) => {
      const r = await resolveLines(tx, [{ productId, unitId: piece, quantity: String(n) }], { allowZero: kind === "COUNT" });
      if (!r.ok) throw new Error(r.message);
      return postAdjustment(tx, { kind, locationId: l.id, reason: "test", submissionKey: randomUUID(), lines: r.lines, user: { id: userId } });
    });

  it("a damage report marks pieces damaged; a shrink marks them missing; found stock gets new pieces", async () => {
    const l = await loc();
    const p = await product();
    await receive(p.id, l.id, 10);
    await adjust(l, p.id, "DAMAGE", 2);
    expect(await items(p.id, { status: "DAMAGED" })).toHaveLength(2);
    await adjust(l, p.id, "DECREASE", 1);
    expect(await items(p.id, { status: "MISSING" })).toHaveLength(1);
    await adjust(l, p.id, "INCREASE", 3);
    const added = await db.itemMovement.count({ where: { item: { productId: p.id }, kind: "ADDED" } });
    expect(added).toBe(3);
    expect(await items(p.id)).toHaveLength(13);
    expect(await balance(p.id, l.id)).toEqual(D(10));
    expect(await present(p.id, l.id)).toBe(10);
  });

  it("a stock count that finds fewer pieces marks the difference missing", async () => {
    const l = await loc();
    const p = await product();
    await receive(p.id, l.id, 10);
    await adjust(l, p.id, "COUNT", 7); // counted 7, the system said 10
    expect(await items(p.id, { status: "MISSING" })).toHaveLength(3);
    expect(await present(p.id, l.id)).toBe(7);
  });

  it("a transfer moves pieces to the new location; to a reseller they are WITH_RESELLER and come back AVAILABLE", async () => {
    const a = await loc();
    const b = await loc();
    const custody = await loc("RESELLER");
    const p = await product();
    await receive(p.id, a.id, 6);
    const move = (from: { id: string }, to: { id: string }, n: string) =>
      db.$transaction(async (tx) => {
        const r = await resolveLines(tx, [{ productId: p.id, unitId: piece, quantity: n }]);
        if (!r.ok) throw new Error(r.message);
        return postTransfer(tx, { fromLocationId: from.id, toLocationId: to.id, notes: null, submissionKey: randomUUID(), lines: r.lines, user: { id: userId } });
      });
    await move(a, b, "2");
    expect(await present(p.id, b.id)).toBe(2);
    expect(await present(p.id, a.id)).toBe(4);
    expect((await items(p.id, { locationId: b.id })).map((i) => i.status)).toEqual(["AVAILABLE", "AVAILABLE"]);

    await move(a, custody, "3");
    const out = await items(p.id, { locationId: custody.id });
    expect(out.map((i) => i.status)).toEqual(["WITH_RESELLER", "WITH_RESELLER", "WITH_RESELLER"]);
    await move(custody, a, "1");
    expect(await items(p.id, { locationId: custody.id })).toHaveLength(2);
    const kinds = (await db.itemMovement.findMany({ where: { item: { productId: p.id } }, select: { kind: true } })).map((m) => m.kind);
    expect(kinds).toContain("ISSUED_TO_RESELLER");
    expect(kinds).toContain("RETURNED_FROM_RESELLER");
    expect(kinds).toContain("TRANSFERRED");
    for (const loc of [a, b, custody]) expect(await present(p.id, loc.id)).toBeLessThanOrEqual(Number(await balance(p.id, loc.id)));
  });

  it("goods returned by a customer put back the pieces that were sold on that invoice line", async () => {
    const l = await loc();
    const p = await product();
    await receive(p.id, l.id, 5);
    const codes = (await items(p.id)).slice(0, 3).map((i) => i.token);
    const { sale } = await sell(l, p.id, "3", codes);
    const line = await db.saleItem.findFirstOrThrow({ where: { saleId: sale.id } });
    const back = await db.$transaction((tx) => moveStockTracked(tx, { productId: p.id, locationId: l.id, type: "CUSTOMER_RETURN", delta: D(2), userId }, { saleItemId: line.id }));
    expect(back.itemIds).toHaveLength(2);
    expect(await items(p.id, { status: "SOLD" })).toHaveLength(1);
    expect(await present(p.id, l.id)).toBe(4);
    const kinds = await db.itemMovement.findMany({ where: { itemId: { in: back.itemIds } }, orderBy: { createdAt: "asc" } });
    expect(kinds.map((m) => m.kind)).toEqual(expect.arrayContaining(["RECEIVED", "SOLD", "RETURNED"]));
  });
});

describe("the database protects identities and history", () => {
  it("status or location cannot change without a movement; identity cannot change; nothing is deleted; history is immutable", async () => {
    const l = await loc();
    const other = await loc();
    const p = await product();
    await receive(p.id, l.id, 2);
    const [a] = await items(p.id);
    await expect(db.inventoryItem.update({ where: { id: a!.id }, data: { status: "SOLD" } })).rejects.toThrow(/recorded movement/);
    await expect(db.inventoryItem.update({ where: { id: a!.id }, data: { locationId: other.id } })).rejects.toThrow(/recorded movement/);
    // a movement for another status does not unlock it
    const m = await db.itemMovement.create({ data: { itemId: a!.id, kind: "DAMAGED", fromStatus: "AVAILABLE", toStatus: "DAMAGED", toLocationId: l.id, userId } });
    await expect(db.inventoryItem.update({ where: { id: a!.id }, data: { status: "SOLD", lastMovementId: m.id } })).rejects.toThrow(/recorded movement/);
    await db.inventoryItem.update({ where: { id: a!.id }, data: { status: "DAMAGED", lastMovementId: m.id } }); // the matching movement does
    await expect(db.inventoryItem.update({ where: { id: a!.id }, data: { itemNo: "SDO-ITEM-000000" } })).rejects.toThrow(/identity/);
    await expect(db.inventoryItem.update({ where: { id: a!.id }, data: { token: "AAAAAAAAAAAAAAAA" } })).rejects.toThrow(/identity/);
    await expect(db.inventoryItem.delete({ where: { id: a!.id } })).rejects.toThrow(/cannot be deleted/);
    await expect(db.itemMovement.update({ where: { id: m.id }, data: { note: "edited" } })).rejects.toThrow(/cannot be changed/);
    await expect(db.itemMovement.delete({ where: { id: m.id } })).rejects.toThrow(/cannot be changed/);
  });

  it("item numbers and tokens are unique in the database", async () => {
    const l = await loc();
    const p = await product();
    await receive(p.id, l.id, 1);
    const [a] = await items(p.id);
    await expect(db.inventoryItem.create({ data: { itemNo: a!.itemNo, token: newToken(), productId: p.id, locationId: l.id } })).rejects.toThrow();
    await expect(db.inventoryItem.create({ data: { itemNo: formatItemNo(99999999), token: a!.token, productId: p.id, locationId: l.id } })).rejects.toThrow();
  });
});

describe("reading codes", () => {
  it("understands QR text, the bare token and the printed number, in any case, and rejects everything else", () => {
    const t = newToken();
    expect(parseItemCode(`SDOI:${t}`)).toEqual({ token: t });
    expect(parseItemCode(t.toLowerCase())).toEqual({ token: t });
    expect(parseItemCode(" sdo-item-000123 ")).toEqual({ itemNo: "SDO-ITEM-000123" });
    for (const bad of ["", "hello", "2000000000015", "SDOI:SHORT", "SDO-ITEM-12"]) expect(parseItemCode(bad)).toBeNull();
    expect(itemQrText(t)).toBe(`SDOI:${t}`);
  });
});
