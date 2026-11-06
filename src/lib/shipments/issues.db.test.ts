import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { getSupplierBalances } from "@/lib/cash/supplier";
import { confirmSession, createShipment, markArrived, saveDraft, ShipmentError, type CountLine } from "./engine";
import { decideIssue, loadIssueRecords } from "./issues";

let ownerId: string;
let shopId: string;
let bottle: string;
let categoryId: string;

beforeAll(async () => {
  const role = await db.role.create({ data: { key: `T_${randomUUID()}`, name: "Test role" } });
  ownerId = (await db.user.create({ data: { username: `o_${randomUUID()}`, name: "Owner", passwordHash: "x", roleId: role.id } })).id;
  shopId = (await db.user.create({ data: { username: `s_${randomUUID()}`, name: "Attendant", passwordHash: "x", roleId: role.id } })).id;
  bottle = (await db.unit.create({ data: { name: `Bottle ${randomUUID()}`, symbol: randomUUID().slice(0, 8) } })).id;
  categoryId = (await db.category.create({ data: { name: `Cat ${randomUUID()}` } })).id;
});

/** A shipment of 24 bottles (total cost 240000, so 10000 each) from a supplier, counted: 20 good, 2 damaged, 2 never came. The investigation is open. */
async function problemShipment() {
  const location = await db.location.create({ data: { code: randomUUID().slice(0, 8).toUpperCase(), name: `Loc ${randomUUID()}` } });
  const supplier = await db.supplier.create({ data: { name: `Supplier ${randomUUID()}` } });
  const product = await db.product.create({ data: { sku: `SKU-${randomUUID()}`, name: "Oil A", categoryId, baseUnitId: bottle, purchasePrice: 0, sellingPrice: 25000 } });
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

const decide = (p: P, kind: "MISSING" | "DAMAGED" | "EXTRA", action: "FOUND" | "NOT_DELIVERED" | "WRITE_OFF" | "KEEP", quantity: string, extra: { note?: string; newOrder?: boolean; key?: string } = {}) =>
  db.$transaction((tx) => decideIssue(tx, { shipmentId: p.s.id, shipmentItemId: p.itemId, kind, action, quantity, note: extra.note ?? "checked", newOrder: extra.newOrder, submissionKey: extra.key ?? randomUUID(), user: { id: ownerId }, currencyDecimals: 0 }), { timeout: 30000 });
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
    expect(r.history[0]!.text).toContain("Written off");
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
