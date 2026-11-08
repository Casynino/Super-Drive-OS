import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { getSupplierBalances } from "@/lib/cash/supplier";
import { confirmSession, createShipment, markArrived, saveDraft, ShipmentError, type CountLine } from "./engine";
import { decideIssue, loadIssueRecords } from "./issues";

let ownerId: string;
let shopId: string;
let bottle: string;
let carton: string;
let categoryId: string;

beforeAll(async () => {
  const role = await db.role.create({ data: { key: `T_${randomUUID()}`, name: "Test role" } });
  ownerId = (await db.user.create({ data: { username: `o_${randomUUID()}`, email: `o_${randomUUID()}@test.local`, name: "Owner", passwordHash: "x", roleId: role.id } })).id;
  shopId = (await db.user.create({ data: { username: `s_${randomUUID()}`, email: `s_${randomUUID()}@test.local`, name: "Attendant", passwordHash: "x", roleId: role.id } })).id;
  bottle = (await db.unit.create({ data: { name: `Bottle ${randomUUID()}`, symbol: randomUUID().slice(0, 8) } })).id;
  carton = (await db.unit.create({ data: { name: `Carton ${randomUUID()}`, symbol: randomUUID().slice(0, 8) } })).id;
  categoryId = (await db.category.create({ data: { name: `Cat ${randomUUID()}` } })).id;
});

/** A shipment of 24 bottles (total cost 240000, so 10000 each) from a supplier, counted: 20 good, 2 damaged, 2 never came. The investigation is open. */
async function problemShipment(withCarton = false) {
  const location = await db.location.create({ data: { code: randomUUID().slice(0, 8).toUpperCase(), name: `Loc ${randomUUID()}` } });
  const supplier = await db.supplier.create({ data: { name: `Supplier ${randomUUID()}` } });
  const product = await db.product.create({ data: { sku: `SKU-${randomUUID()}`, name: "Oil A", categoryId, baseUnitId: bottle, purchasePrice: 0, sellingPrice: 25000, ...(withCarton ? { units: { create: [{ unitId: carton, factor: 12 }] } } : {}) } });
  const s = await db.$transaction((tx) =>
    createShipment(tx, { user: { id: ownerId }, supplierId: supplier.id, reference: null, cargoName: "Cargo", expectedDate: null, locationId: location.id, notes: null, lines: [{ productId: product.id, unitId: bottle, quantity: "24", totalCost: "240000" }], submissionKey: randomUUID(), currencyDecimals: 0 }),
  );
  await db.$transaction((tx) => markArrived(tx, { shipmentId: s.id, user: { id: shopId } }));
  const lines: CountLine[] = [{ shipmentItemId: null, productId: product.id, unitId: bottle, good: "20", damaged: "2", note: null }];
  const saved = await db.$transaction((tx) => saveDraft(tx, { shipmentId: s.id, user: { id: shopId }, notes: null, finish: true, lines }));
  await db.$transaction((tx) => confirmSession(tx, { shipmentId: s.id, sessionId: saved.sessionId, user: { id: shopId } }), { timeout: 30000 });
  const item = await db.shipmentItem.findFirstOrThrow({ where: { shipmentId: s.id, productId: product.id } });
  return { s, product, supplier, location, itemId: item.id };
}
type P = Awaited<ReturnType<typeof problemShipment>>;

const decide = (p: P, kind: "MISSING" | "DAMAGED" | "EXTRA", action: "FOUND" | "NOT_DELIVERED" | "WRITE_OFF" | "KEEP" | "DISCOUNT_SELL" | "DISMISS", quantity: string, extra: { note?: string; newOrder?: boolean; key?: string; price?: string } = {}) =>
  db.$transaction((tx) => decideIssue(tx, { shipmentId: p.s.id, shipmentItemId: p.itemId, kind, action, quantity, note: extra.note ?? "checked", newOrder: extra.newOrder, discountPrice: extra.price, submissionKey: extra.key ?? randomUUID(), user: { id: ownerId }, currencyDecimals: 0 }), { timeout: 30000 });
const shelf = async (p: P) => (await db.stockBalance.findUnique({ where: { productId_locationId: { productId: p.product.id, locationId: p.location.id } } }))?.quantity.toString() ?? "0";
const records = (p: P) => loadIssueRecords(db, { shipmentIds: [p.s.id], withCost: true });
const owedTo = async (p: P) => (await getSupplierBalances(db)).find((b) => b.id === p.supplier.id)!;

describe("what is under investigation", () => {
  it("lists the damaged and the missing pieces, and none of them is on the shelf", async () => {
    const p = await problemShipment();
    const r = await records(p);
    expect(r.map((x) => `${x.kind}:${x.open}`).sort()).toEqual(["DAMAGED:2", "MISSING:2"]);
    expect(await shelf(p)).toBe("20"); // only the 20 good ones
    expect((await db.shipment.findUniqueOrThrow({ where: { id: p.s.id } })).issue).toBe("OPEN");
    expect(r.find((x) => x.kind === "MISSING")!.type).toBe("MISSING");
  });
});

describe("missing pieces", () => {
  it("found: a partial find goes back into stock under the same shipment and the rest stays open", async () => {
    const p = await problemShipment();
    const res = await decide(p, "MISSING", "FOUND", "1");
    expect(res.receiptNo).toMatch(/^GRN-/);
    expect(await shelf(p)).toBe("21");
    const items = await db.inventoryItem.count({ where: { shipmentId: p.s.id, productId: p.product.id, status: "AVAILABLE" } });
    expect(items).toBe(21);
    expect((await records(p)).find((x) => x.kind === "MISSING")!.open).toBe(1);
    expect((await db.shipment.findUniqueOrThrow({ where: { id: p.s.id } })).issue).toBe("OPEN");
    // found goods are not a second purchase: what we owe the supplier is still the cost of the shipment
    expect((await owedTo(p)).owed).toBe(240000);
  });

  it("cannot decide more than is open, and a double submit does nothing twice", async () => {
    const p = await problemShipment();
    await expect(decide(p, "MISSING", "FOUND", "3")).rejects.toThrow(ShipmentError);
    const key = randomUUID();
    await decide(p, "MISSING", "FOUND", "1", { key });
    const again = await decide(p, "MISSING", "FOUND", "1", { key });
    expect(again.repeated).toBe(true);
    expect(await shelf(p)).toBe("21");
  });

  it("not delivered: no stock is added, the supplier is not owed for it, and it can be carried to a new order", async () => {
    const p = await problemShipment();
    const res = await decide(p, "MISSING", "NOT_DELIVERED", "2", { note: "Supplier confirmed short shipment", newOrder: true });
    expect(await shelf(p)).toBe("20"); // never received, so nothing is added
    expect(res.newOrderNo).toMatch(/^PO-/);
    const order = await db.shipment.findFirstOrThrow({ where: { shipmentNo: res.newOrderNo! }, include: { items: true } });
    expect(order.status).toBe("EXPECTED");
    expect(order.items[0]!.expectedQty.toString()).toBe("2");
    expect(order.items[0]!.lineCost!.toString()).toBe("20000");
    // 240000 for the first shipment, minus 20000 never delivered, plus 20000 for the replacement
    expect((await owedTo(p)).owed).toBe(240000);
  });

  it("needs a reason", async () => {
    const p = await problemShipment();
    await expect(decide(p, "MISSING", "NOT_DELIVERED", "1", { note: "" })).rejects.toThrow(ShipmentError);
  });
});

describe("damaged pieces", () => {
  it("write off: the pieces are marked disposed for good, stock does not move, and the history is kept", async () => {
    const p = await problemShipment();
    await decide(p, "DAMAGED", "WRITE_OFF", "2", { note: "Leaking gallons" });
    expect(await shelf(p)).toBe("20");
    expect(await db.inventoryItem.count({ where: { shipmentId: p.s.id, status: "DISPOSED" } })).toBe(2);
    expect(await db.inventoryItem.count({ where: { shipmentId: p.s.id } })).toBe(22); // nothing was deleted
    const r = (await records(p)).find((x) => x.kind === "DAMAGED")!;
    expect(r.open).toBe(0);
    expect(r.history[0]!.action).toBe("WRITE_OFF");
  });

  it("the only action for damaged pieces is write-off", async () => {
    const p = await problemShipment();
    await expect(decide(p, "DAMAGED", "FOUND", "1")).rejects.toThrow(ShipmentError);
  });
});

describe("closing", () => {
  it("the investigation closes by itself once every problem is decided, and decisions cannot be edited", async () => {
    const p = await problemShipment();
    await decide(p, "DAMAGED", "WRITE_OFF", "2");
    await decide(p, "MISSING", "FOUND", "1");
    expect((await db.shipment.findUniqueOrThrow({ where: { id: p.s.id } })).issue).toBe("OPEN");
    const last = await decide(p, "MISSING", "NOT_DELIVERED", "1");
    expect(last.closed).toBe(true);
    expect((await db.shipment.findUniqueOrThrow({ where: { id: p.s.id } })).issue).toBe("RESOLVED");
    await expect(decide(p, "MISSING", "FOUND", "1")).rejects.toThrow(ShipmentError);
    const d = await db.shipmentIssueDecision.findFirstOrThrow({ where: { shipmentId: p.s.id } });
    await expect(db.shipmentIssueDecision.update({ where: { id: d.id }, data: { note: "changed" } })).rejects.toThrow();
    await expect(db.shipmentIssueDecision.delete({ where: { id: d.id } })).rejects.toThrow();
  });
});

describe("damaged pieces sold at a discount", () => {
  const variantOf = (p: P) => db.product.findUniqueOrThrow({ where: { sku: `${p.product.sku}-DMG` }, include: { units: true } });
  const shelfOf = async (productId: string, p: P) => (await db.stockBalance.findUnique({ where: { productId_locationId: { productId, locationId: p.location.id } } }))?.quantity.toString() ?? "0";

  it("moves the pieces into their own cheaper product and leaves the normal product and price alone", async () => {
    const p = await problemShipment();
    await expect(decide(p, "DAMAGED", "DISCOUNT_SELL", "2", { price: "30000" })).rejects.toThrow(ShipmentError); // not lower than 25000
    await expect(decide(p, "DAMAGED", "DISCOUNT_SELL", "2", { price: "" })).rejects.toThrow(ShipmentError);
    await decide(p, "DAMAGED", "DISCOUNT_SELL", "2", { price: "20000" });
    const v = await variantOf(p);
    expect(v.sellingPrice.toString()).toBe("20000");
    expect(v.name).toContain("damaged packaging");
    expect(await shelfOf(v.id, p)).toBe("2"); // on sale
    expect(await shelf(p)).toBe("20"); // the normal product is unchanged
    expect((await db.product.findUniqueOrThrow({ where: { id: p.product.id } })).sellingPrice.toString()).toBe("25000");
    expect(await db.inventoryItem.count({ where: { shipmentId: p.s.id, productId: p.product.id, status: "DISPOSED" } })).toBe(2); // the damaged ones are accounted for, never lost
    expect(await db.inventoryItem.count({ where: { productId: v.id, status: "AVAILABLE" } })).toBe(2);
    const d = await db.shipmentIssueDecision.findFirstOrThrow({ where: { shipmentId: p.s.id, action: "DISCOUNT_SELL" } });
    expect(d.variantProductId).toBe(v.id);
    expect((await records(p)).find((x) => x.kind === "DAMAGED")!.open).toBe(0);
  });

  it("a carton price is kept exactly and a partial decision can be topped up later", async () => {
    const p = await problemShipment(true);
    await decide(p, "DAMAGED", "DISCOUNT_SELL", "1", { price: "280000" }); // 1 piece at a price quoted per carton of 12
    const v = await variantOf(p);
    expect(v.units.find((u) => u.unitId === carton)!.sellingPrice!.toString()).toBe("280000"); // exact, no rounding drift
    await decide(p, "DAMAGED", "WRITE_OFF", "1", { note: "Leaking" });
    expect((await db.shipment.findUniqueOrThrow({ where: { id: p.s.id } })).issue).toBe("OPEN"); // the missing pieces are still open
    expect((await records(p)).find((x) => x.kind === "DAMAGED")!.open).toBe(0);
  });
});

describe("remove from the list", () => {
  it("closes a record without touching stock or money, needs a reason, and keeps the history", async () => {
    const p = await problemShipment();
    const owedBefore = (await owedTo(p)).owed;
    await expect(decide(p, "MISSING", "DISMISS", "2", { note: "" })).rejects.toThrow(ShipmentError);
    await decide(p, "MISSING", "DISMISS", "2", { note: "The shop counted wrong, nothing is missing" });
    expect(await shelf(p)).toBe("20"); // no stock change
    expect((await owedTo(p)).owed).toBe(owedBefore); // no money change
    const r = (await records(p)).find((x) => x.kind === "MISSING")!;
    expect(r.open).toBe(0);
    expect(r.history[0]!.action).toBe("DISMISS");
    expect(r.history[0]!.note).toContain("counted wrong");
    // the damaged record is still open: the investigation stays open until it is decided too
    expect((await db.shipment.findUniqueOrThrow({ where: { id: p.s.id } })).issue).toBe("OPEN");
    await decide(p, "DAMAGED", "DISMISS", "2", { note: "Duplicate of an adjustment already recorded" });
    expect((await db.shipment.findUniqueOrThrow({ where: { id: p.s.id } })).issue).toBe("RESOLVED");
    expect(await db.shipmentIssueDecision.count({ where: { shipmentId: p.s.id } })).toBe(2); // nothing was deleted
  });
});
