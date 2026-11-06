import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { InsufficientStockError, moveStock } from "@/lib/inventory/engine";
import { postReceipt } from "@/lib/inventory/documents";
import { resolveLines } from "@/lib/inventory/lines";
import { completeReversal, createReversalRequest } from "@/lib/sales/reversals";
import { postSale, type SaleInput } from "@/lib/sales/post-sale";
import { PickupError, loadPickup, markReady, parseScan, pickupBlock, releasePickup, startPreparing } from "./pickup";

const D = (v: string | number) => new Prisma.Decimal(v);
let userId: string; // the shop attendant who sells
let keeperId: string; // the warehouse attendant
let unitBottle: string;
let categoryId: string;

beforeAll(async () => {
  const role = await db.role.create({ data: { key: `T_${randomUUID()}`, name: "Test role" } });
  userId = (await db.user.create({ data: { username: `t_${randomUUID()}`, name: "Seller", passwordHash: "x", roleId: role.id } })).id;
  keeperId = (await db.user.create({ data: { username: `t_${randomUUID()}`, name: "Keeper", passwordHash: "x", roleId: role.id } })).id;
  unitBottle = (await db.unit.create({ data: { name: `Bottle ${randomUUID()}`, symbol: randomUUID().slice(0, 8) } })).id;
  categoryId = (await db.category.create({ data: { name: `Cat ${randomUUID()}` } })).id;
});

/** A warehouse (sales from it make pickup notes) with one product holding `stock` bottles. */
async function warehouse(stock = 100, pickupRequired = true) {
  const location = await db.location.create({ data: { code: randomUUID().slice(0, 8).toUpperCase(), name: `WH ${randomUUID()}`, pickupRequired } });
  const product = await db.product.create({ data: { sku: `SKU-${randomUUID()}`, name: "Test oil", categoryId, baseUnitId: unitBottle, purchasePrice: 10000, sellingPrice: 25000, allowPieceSales: true } });
  await db.$transaction(async (tx) => {
    const r = await resolveLines(tx, [{ productId: product.id, unitId: unitBottle, quantity: String(stock) }]);
    if (!r.ok) throw new Error(r.message);
    await postReceipt(tx, { type: "OPENING_STOCK", supplierId: null, locationId: location.id, supplierInvoice: null, receivedDate: new Date(), notes: null, submissionKey: randomUUID(), lines: r.lines.map((l) => ({ ...l, lineTotal: D(stock * 10000) })), user: { id: userId } });
  });
  return { location, product };
}

const balance = async (w: { location: { id: string }; product: { id: string } }) => {
  const b = await db.stockBalance.findUniqueOrThrow({ where: { productId_locationId: { productId: w.product.id, locationId: w.location.id } } });
  return { quantity: b.quantity.toString(), reserved: b.reserved.toString(), available: b.quantity.minus(b.reserved).toString() };
};

function sell(w: { location: { id: string }; product: { id: string } }, quantity = "1", over: Partial<SaleInput> = {}) {
  const input: SaleInput = {
    user: { id: userId },
    can: { discount: false, credit: true, approveCreditException: false },
    customerId: null,
    locationId: w.location.id,
    mode: "FULL",
    method: "CASH",
    partAmount: null,
    reference: null,
    notes: null,
    lines: [{ productId: w.product.id, unitId: unitBottle, quantity, unitPrice: "" }],
    creditException: null,
    submissionKey: randomUUID(),
    currencyDecimals: 0,
    creditTermsDays: 30,
    ...over,
  };
  return db.$transaction((tx) => postSale(tx, input), { timeout: 30000 });
}

const release = (noteId: string, over: Partial<Parameters<typeof releasePickup>[1]> = {}) =>
  db.$transaction((tx) => releasePickup(tx, { noteId, userId: keeperId, submissionKey: randomUUID(), ...over }), { timeout: 30000 });

describe("selling from the warehouse reserves stock and makes a pickup note", () => {
  it("physical stock stays, available drops, no SOLD movement yet, one note with a secret token", async () => {
    const w = await warehouse(100);
    const { sale, pickup } = await sell(w, "20");
    expect(pickup).not.toBeNull();
    expect(pickup!.noteNo).toMatch(/^PU-\d{4}-\d{6}$/);
    expect(pickup!.status).toBe("NEW");
    expect(pickup!.auth).toBe("PAID");
    expect(pickup!.token.length).toBeGreaterThanOrEqual(30);
    expect(await balance(w)).toEqual({ quantity: "100", reserved: "20", available: "80" }); // physical 100, reserved 20, available 80
    expect(await db.stockMovement.count({ where: { referenceType: "Sale", referenceId: sale.id } })).toBe(0);
    const ev = await db.warehouseEvent.findFirstOrThrow({ where: { pickupNoteId: pickup!.id, type: "RESERVED" } });
    expect([ev.previousReserved!.toString(), ev.newReserved!.toString()]).toEqual(["0", "20"]);
  });

  it("cannot sell what is already reserved: only the 80 available can be sold, and a refused sale leaves nothing behind", async () => {
    const w = await warehouse(100);
    await sell(w, "20");
    await expect(sell(w, "81")).rejects.toBeInstanceOf(InsufficientStockError);
    expect(await db.sale.count({ where: { locationId: w.location.id } })).toBe(1);
    expect(await db.pickupNote.count({ where: { locationId: w.location.id } })).toBe(1);
    await sell(w, "80");
    expect(await balance(w)).toEqual({ quantity: "100", reserved: "100", available: "0" });
    await expect(sell(w, "1")).rejects.toBeInstanceOf(InsufficientStockError);
  });

  it("two sales racing for the last bottle: exactly one wins", async () => {
    const w = await warehouse(1);
    const results = await Promise.allSettled([sell(w, "1"), sell(w, "1")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await balance(w)).toEqual({ quantity: "1", reserved: "1", available: "0" });
  });

  it("nothing else can take reserved stock: a transfer, damage or adjustment is limited to what is available", async () => {
    const w = await warehouse(100);
    await sell(w, "30");
    const take = (n: number) => db.$transaction((tx) => moveStock(tx, { productId: w.product.id, locationId: w.location.id, type: "ADJUSTMENT", delta: D(-n), userId: keeperId }));
    await expect(take(71)).rejects.toBeInstanceOf(InsufficientStockError); // only 70 are free
    await take(70);
    expect(await balance(w)).toEqual({ quantity: "30", reserved: "30", available: "0" });
  });

  it("the database itself refuses reserved stock above physical stock", async () => {
    const w = await warehouse(10);
    await expect(db.$executeRaw`UPDATE "StockBalance" SET "reserved" = 11 WHERE "productId" = ${w.product.id} AND "locationId" = ${w.location.id}`).rejects.toThrow();
  });

  it("a location without the pickup switch still takes the stock off at once (as before)", async () => {
    const w = await warehouse(10, false);
    const { sale, pickup } = await sell(w, "4");
    expect(pickup).toBeNull();
    expect(await balance(w)).toEqual({ quantity: "6", reserved: "0", available: "6" });
    expect(await db.stockMovement.count({ where: { referenceType: "Sale", referenceId: sale.id, type: "SOLD" } })).toBe(1);
  });

  it("credit sales that pass the credit rules get a note marked as credit; an unpaid sale cannot exist without a customer on credit", async () => {
    const w = await warehouse(10);
    const customer = await db.customer.create({ data: { name: `C ${randomUUID()}`, phone: "0712 000 111", creditLimit: 1_000_000 } });
    const { pickup } = await sell(w, "2", { mode: "CREDIT", method: null, customerId: customer.id });
    expect(pickup!.auth).toBe("CREDIT_APPROVED");
    await expect(sell(w, "1", { mode: "CREDIT", method: null, customerId: null })).rejects.toThrow(); // credit needs a customer
  });
});

describe("handing the goods over", () => {
  it("scan -> prepare -> ready -> release: stock leaves, reservation ends, the attendant and time are recorded", async () => {
    const w = await warehouse(100);
    const { sale, pickup } = await sell(w, "20");
    await db.$transaction((tx) => startPreparing(tx, { noteId: pickup!.id, userId: keeperId }));
    await db.$transaction((tx) => markReady(tx, { noteId: pickup!.id, userId: keeperId }));
    expect((await db.pickupNote.findUniqueOrThrow({ where: { id: pickup!.id } })).status).toBe("READY");

    const r = await release(pickup!.id, { collectedBy: "Rep Juma" });
    expect(r.completed).toBe(true);
    expect(r.releaseNo).toMatch(/^COL-\d{4}-\d{6}$/);
    expect(await balance(w)).toEqual({ quantity: "80", reserved: "0", available: "80" });

    const move = await db.stockMovement.findFirstOrThrow({ where: { referenceType: "Sale", referenceId: sale.id } });
    expect([move.type, move.quantity.toString(), move.previousQty.toString(), move.newQty.toString(), move.userId]).toEqual(["SOLD", "-20", "100", "80", keeperId]);
    expect(move.unitCost!.toString()).toBe("10000"); // the cost snapshot taken at the sale

    const note = await db.pickupNote.findUniqueOrThrow({ where: { id: pickup!.id }, include: { releases: true } });
    expect(note.status).toBe("COMPLETED");
    expect(note.completedById).toBe(keeperId);
    expect(note.completedAt).not.toBeNull();
    expect(note.releases).toHaveLength(1);
    expect(note.releases[0]!.collectedBy).toBe("Rep Juma");
  });

  it("a collected note can never be used again, and the refusal says when and by whom", async () => {
    const w = await warehouse(10);
    const { pickup } = await sell(w, "3");
    await release(pickup!.id);
    await expect(release(pickup!.id)).rejects.toMatchObject({ code: "ALREADY_COLLECTED" });
    const view = await loadPickup(db, { id: pickup!.id });
    const block = pickupBlock(view!);
    expect(block!.code).toBe("ALREADY_COLLECTED");
    expect(block!.message).toContain("Keeper");
    expect(await balance(w)).toEqual({ quantity: "7", reserved: "0", available: "7" });
  });

  it("pressing the button twice (same submission) releases once", async () => {
    const w = await warehouse(10);
    const { pickup } = await sell(w, "3");
    const key = randomUUID();
    const results = await Promise.allSettled([release(pickup!.id, { submissionKey: key }), release(pickup!.id, { submissionKey: key })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await balance(w)).toEqual({ quantity: "7", reserved: "0", available: "7" });
  });

  it("partial collection: the rest stays reserved, the note is not completed, and the rest can be collected later", async () => {
    const w = await warehouse(100);
    const { pickup } = await sell(w, "10");
    const item = await db.pickupNoteItem.findFirstOrThrow({ where: { noteId: pickup!.id } });

    await expect(release(pickup!.id, { items: [{ noteItemId: item.id, quantity: D(11) }] })).rejects.toMatchObject({ code: "MISMATCH" });
    const first = await release(pickup!.id, { items: [{ noteItemId: item.id, quantity: D(4) }] });
    expect(first.completed).toBe(false);
    expect(first.left.toString()).toBe("6");
    expect((await db.pickupNote.findUniqueOrThrow({ where: { id: pickup!.id } })).status).toBe("PARTIAL");
    expect(await balance(w)).toEqual({ quantity: "96", reserved: "6", available: "90" });

    await expect(release(pickup!.id, { items: [{ noteItemId: item.id, quantity: D(7) }] })).rejects.toMatchObject({ code: "MISMATCH" });
    const rest = await release(pickup!.id); // default = everything still waiting
    expect(rest.completed).toBe(true);
    expect(await balance(w)).toEqual({ quantity: "90", reserved: "0", available: "90" });
    expect(await db.pickupRelease.count({ where: { noteId: pickup!.id } })).toBe(2);
  });

  it("goods that belong to another note's line cannot be released through this one", async () => {
    const w = await warehouse(10);
    const a = await sell(w, "2");
    const b = await sell(w, "3");
    const itemOfB = await db.pickupNoteItem.findFirstOrThrow({ where: { noteId: b.pickup!.id } });
    await expect(release(a.pickup!.id, { items: [{ noteItemId: itemOfB.id, quantity: D(1) }] })).rejects.toMatchObject({ code: "MISMATCH" });
  });
});

describe("a sale cancelled or returned", () => {
  const cancel = async (saleId: string) => {
    const req = await db.$transaction((tx) => createReversalRequest(tx, { user: { id: userId }, saleId, kind: "CANCEL", reason: "Customer changed his mind", refundMethod: "CASH", refundReference: null, lines: [], submissionKey: randomUUID() }));
    return db.$transaction((tx) => completeReversal(tx, { reversalId: req.id, approver: { id: keeperId }, dp: 0 }), { timeout: 30000 });
  };

  it("before collection: the reservation is given back, the note is cancelled, no stock moves, and a scan is refused", async () => {
    const w = await warehouse(50);
    const { sale, pickup } = await sell(w, "10");
    await cancel(sale.id);
    expect(await balance(w)).toEqual({ quantity: "50", reserved: "0", available: "50" });
    const note = await db.pickupNote.findUniqueOrThrow({ where: { id: pickup!.id } });
    expect(note.status).toBe("CANCELLED");
    expect(await db.stockMovement.count({ where: { referenceType: "SaleReversal", productId: w.product.id } })).toBe(0);
    await expect(release(pickup!.id)).rejects.toMatchObject({ code: "CANCELLED" });
    expect(await db.warehouseEvent.count({ where: { pickupNoteId: pickup!.id, type: "RESERVATION_FREED" } })).toBe(1);
  });

  it("after collection: the goods come back as stock through the normal return, and the note stays completed", async () => {
    const w = await warehouse(50);
    const { sale, pickup } = await sell(w, "10");
    await release(pickup!.id);
    expect(await balance(w)).toEqual({ quantity: "40", reserved: "0", available: "40" });
    await cancel(sale.id);
    expect(await balance(w)).toEqual({ quantity: "50", reserved: "0", available: "50" });
    expect(await db.stockMovement.count({ where: { referenceType: "SaleReversal", productId: w.product.id, type: "CUSTOMER_RETURN" } })).toBe(1);
    expect((await db.pickupNote.findUniqueOrThrow({ where: { id: pickup!.id } })).status).toBe("COMPLETED");
  });

  it("half collected, then cancelled: the collected half returns as stock, the waiting half is released, the note is completed", async () => {
    const w = await warehouse(50);
    const { sale, pickup } = await sell(w, "10");
    const item = await db.pickupNoteItem.findFirstOrThrow({ where: { noteId: pickup!.id } });
    await release(pickup!.id, { items: [{ noteItemId: item.id, quantity: D(4) }] });
    expect(await balance(w)).toEqual({ quantity: "46", reserved: "6", available: "40" });
    await cancel(sale.id);
    expect(await balance(w)).toEqual({ quantity: "50", reserved: "0", available: "50" });
    expect((await db.pickupNote.findUniqueOrThrow({ where: { id: pickup!.id } })).status).toBe("COMPLETED");
  });
});

describe("records cannot be altered", () => {
  it("a completed note, a collection record and the activity log cannot be changed or deleted", async () => {
    const w = await warehouse(10);
    const { pickup } = await sell(w, "2");
    const done = await release(pickup!.id);
    await expect(db.pickupNote.update({ where: { id: pickup!.id }, data: { status: "NEW" } })).rejects.toThrow();
    await expect(db.pickupNote.delete({ where: { id: pickup!.id } })).rejects.toThrow();
    await expect(db.pickupRelease.update({ where: { id: done.release.id }, data: { collectedBy: "Someone else" } })).rejects.toThrow();
    await expect(db.pickupRelease.delete({ where: { id: done.release.id } })).rejects.toThrow();
    const ev = await db.warehouseEvent.findFirstOrThrow({ where: { pickupNoteId: pickup!.id } });
    await expect(db.warehouseEvent.delete({ where: { id: ev.id } })).rejects.toThrow();
  });

  it("a note keeps its token and number for ever, and collected quantities can never go down", async () => {
    const w = await warehouse(10);
    const { pickup } = await sell(w, "2");
    await expect(db.pickupNote.update({ where: { id: pickup!.id }, data: { token: "changed" } })).rejects.toThrow();
    const item = await db.pickupNoteItem.findFirstOrThrow({ where: { noteId: pickup!.id } });
    await expect(db.pickupNoteItem.update({ where: { id: item.id }, data: { quantity: 99 } })).rejects.toThrow();
    await release(pickup!.id, { items: [{ noteItemId: item.id, quantity: D(1) }] });
    await expect(db.pickupNoteItem.update({ where: { id: item.id }, data: { releasedQty: 0 } })).rejects.toThrow();
  });
});

describe("reading a scan", () => {
  it("understands the QR text, a bare token and the printed number, and nothing else", () => {
    expect(parseScan("SDOPU:abc123")).toEqual({ token: "abc123" });
    expect(parseScan("pu-2026-000125")).toEqual({ noteNo: "PU-2026-000125" });
    expect(parseScan("x".repeat(30))).toEqual({ token: "x".repeat(30) });
    expect(parseScan("")).toBeNull();
    expect(parseScan("hello world")).toBeNull();
    expect(PickupError).toBeDefined();
  });
});
