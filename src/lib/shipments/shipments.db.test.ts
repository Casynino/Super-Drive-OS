import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { cancelShipment, confirmSession, createShipment, resolveIssue, saveDraft, ShipmentError, type CountLine } from "./engine";

const D = (v: string | number) => new Prisma.Decimal(v);
let ownerId: string;
let shopId: string;
let bottle: string;
let carton: string;
let categoryId: string;

beforeAll(async () => {
  const role = await db.role.create({ data: { key: `T_${randomUUID()}`, name: "Test role" } });
  ownerId = (await db.user.create({ data: { username: `o_${randomUUID()}`, name: "Owner", passwordHash: "x", roleId: role.id } })).id;
  shopId = (await db.user.create({ data: { username: `s_${randomUUID()}`, name: "Attendant", passwordHash: "x", roleId: role.id } })).id;
  bottle = (await db.unit.create({ data: { name: `Bottle ${randomUUID()}`, symbol: randomUUID().slice(0, 8) } })).id;
  carton = (await db.unit.create({ data: { name: `Carton ${randomUUID()}`, symbol: randomUUID().slice(0, 8) } })).id;
  categoryId = (await db.category.create({ data: { name: `Cat ${randomUUID()}` } })).id;
});

async function world() {
  const location = await db.location.create({ data: { code: randomUUID().slice(0, 8).toUpperCase(), name: `Loc ${randomUUID()}` } });
  const mk = (name: string) => db.product.create({ data: { sku: `SKU-${randomUUID()}`, name, categoryId, baseUnitId: bottle, purchasePrice: 0, sellingPrice: 25000, units: { create: [{ unitId: carton, factor: 12 }] } } });
  const [a, b] = await Promise.all([mk("Oil A"), mk("Oil B")]);
  return { location, a, b };
}
type W = Awaited<ReturnType<typeof world>>;

/** Announce 2 cartons of A (24 bottles, total cost 240000) and optionally 1 carton of B (12 bottles, 60000). */
function announce(w: W, withB = false) {
  return db.$transaction((tx) =>
    createShipment(tx, {
      user: { id: ownerId },
      supplierId: null,
      reference: "CN-123",
      expectedDate: "2026-12-01",
      locationId: w.location.id,
      notes: null,
      lines: [{ productId: w.a.id, unitId: carton, quantity: "2", totalCost: "240000" }, ...(withB ? [{ productId: w.b.id, unitId: carton, quantity: "1", totalCost: "60000" }] : [])],
      submissionKey: randomUUID(),
      currencyDecimals: 0,
    }),
  );
}

const line = (productId: string, good: string, damaged = "0", unitId = bottle, shipmentItemId: string | null = null): CountLine => ({ shipmentItemId, productId, unitId, good, damaged, note: null });

/** shop saves a draft then confirms it */
async function count(shipmentId: string, lines: CountLine[], finish = false) {
  const saved = await db.$transaction((tx) => saveDraft(tx, { shipmentId, user: { id: shopId }, notes: null, finish, lines }));
  return db.$transaction((tx) => confirmSession(tx, { shipmentId, sessionId: saved.sessionId, user: { id: shopId } }), { timeout: 30000 });
}

const stock = async (w: W, productId: string) => (await db.stockBalance.findUnique({ where: { productId_locationId: { productId, locationId: w.location.id } } }))?.quantity.toString() ?? "0";
const reload = (id: string) => db.shipment.findUniqueOrThrow({ where: { id } });

describe("announcing and counting", () => {
  it("announcing a shipment changes no stock; a draft count changes no stock; only confirming does", async () => {
    const w = await world();
    const s = await announce(w);
    expect(s.shipmentNo).toMatch(/^SHP-\d{4}-\d{6}$/);
    expect(await stock(w, w.a.id)).toBe("0");

    await db.$transaction((tx) => saveDraft(tx, { shipmentId: s.id, user: { id: shopId }, notes: null, finish: false, lines: [line(w.a.id, "24")] }));
    expect(await stock(w, w.a.id)).toBe("0"); // still just a draft

    const draft = await db.shipmentReceiving.findFirstOrThrow({ where: { shipmentId: s.id } });
    await db.$transaction((tx) => confirmSession(tx, { shipmentId: s.id, sessionId: draft.id, user: { id: shopId } }));
    expect(await stock(w, w.a.id)).toBe("24");
  });

  it("a full, clean delivery completes the shipment, uses the owner's cost, and raises no issue", async () => {
    const w = await world();
    const s = await announce(w);
    const r = await count(s.id, [line(w.a.id, "2", "0", carton)]); // counted in cartons
    expect(r.finished).toBe(true);
    expect(r.problem).toBe(false);

    const after = await reload(s.id);
    expect([after.status, after.issue]).toEqual(["RECEIVED", "NONE"]);
    expect(await stock(w, w.a.id)).toBe("24");
    expect((await db.product.findUniqueOrThrow({ where: { id: w.a.id } })).avgCost.toString()).toBe("10000"); // 240000 / 24
    const receipt = await db.stockReceipt.findFirstOrThrow({ where: { receiptNo: r.receiptNo! } });
    expect(receipt.totalCost.toString()).toBe("240000");
  });

  it("a delivery in two parts: PARTIAL, then RECEIVED; the draft can be edited before confirming", async () => {
    const w = await world();
    const s = await announce(w);
    // first draft has a mistake (20), the attendant fixes it to 12 before confirming
    await db.$transaction((tx) => saveDraft(tx, { shipmentId: s.id, user: { id: shopId }, notes: null, finish: false, lines: [line(w.a.id, "20")] }));
    const fixed = await db.$transaction((tx) => saveDraft(tx, { shipmentId: s.id, user: { id: shopId }, notes: "first truck", finish: false, lines: [line(w.a.id, "12")] }));
    await db.$transaction((tx) => confirmSession(tx, { shipmentId: s.id, sessionId: fixed.sessionId, user: { id: shopId } }));
    expect((await reload(s.id)).status).toBe("PARTIAL");
    expect(await stock(w, w.a.id)).toBe("12");

    const r2 = await count(s.id, [line(w.a.id, "12")]);
    expect(r2.finished).toBe(true);
    expect((await reload(s.id)).status).toBe("RECEIVED");
    expect(await stock(w, w.a.id)).toBe("24");
    expect(await db.shipmentReceiving.count({ where: { shipmentId: s.id } })).toBe(2);
  });
});

describe("problems go to the owner", () => {
  it("damaged on arrival: counted in, written off, and the shipment is flagged", async () => {
    const w = await world();
    const s = await announce(w);
    const r = await count(s.id, [line(w.a.id, "20", "4")]);
    expect(r.problem).toBe(true);
    expect(await stock(w, w.a.id)).toBe("20"); // 24 arrived, 4 written off
    const types = (await db.stockMovement.findMany({ where: { productId: w.a.id }, orderBy: { createdAt: "asc" } })).map((m) => [m.type, m.quantity.toString()]);
    expect(types).toEqual([["RECEIVED", "24"], ["DAMAGED", "-4"]]);
    expect((await reload(s.id)).issue).toBe("OPEN");
  });

  it("missing goods: closing the shipment records the shortfall and flags it", async () => {
    const w = await world();
    const s = await announce(w, true);
    const r = await count(s.id, [line(w.a.id, "24")], true); // product B never arrived; "nothing more is coming"
    expect(r.finished).toBe(true);
    expect(r.missing.map((m) => m.qty.toString())).toEqual(["12"]);
    const b = await db.shipmentItem.findFirstOrThrow({ where: { shipmentId: s.id, productId: w.b.id } });
    expect(b.missingQty.toString()).toBe("12");
    expect(await stock(w, w.b.id)).toBe("0");
    expect((await reload(s.id)).issue).toBe("OPEN");
  });

  it("more than announced, and goods nobody announced, are accepted into stock but flagged", async () => {
    const w = await world();
    const s = await announce(w);
    const r = await count(s.id, [line(w.a.id, "26"), line(w.b.id, "5")]); // 2 extra of A, and B was never announced
    expect(r.problem).toBe(true);
    expect(await stock(w, w.a.id)).toBe("26");
    expect(await stock(w, w.b.id)).toBe("5");
    const extra = await db.shipmentItem.findFirstOrThrow({ where: { shipmentId: s.id, productId: w.b.id } });
    expect(extra.unexpected).toBe(true);
    // unannounced goods have no cost, so they must not drag the average cost to zero
    expect((await db.product.findUniqueOrThrow({ where: { id: w.b.id } })).avgCost.toString()).toBe("0");
    expect((await reload(s.id)).issue).toBe("OPEN");
  });

  it("the owner investigates and closes the issue, with a note", async () => {
    const w = await world();
    const s = await announce(w);
    await count(s.id, [line(w.a.id, "20", "4")]);
    await expect(db.$transaction((tx) => resolveIssue(tx, { shipmentId: s.id, user: { id: ownerId }, note: "" }))).rejects.toBeInstanceOf(ShipmentError);
    await db.$transaction((tx) => resolveIssue(tx, { shipmentId: s.id, user: { id: ownerId }, note: "Supplier will refund 4 bottles" }));
    const after = await reload(s.id);
    expect([after.issue, after.resolutionNote]).toEqual(["RESOLVED", "Supplier will refund 4 bottles"]);
    await expect(db.$transaction((tx) => resolveIssue(tx, { shipmentId: s.id, user: { id: ownerId }, note: "again" }))).rejects.toBeInstanceOf(ShipmentError);
  });
});

describe("safety", () => {
  it("a confirmed count cannot be confirmed twice, edited, or deleted; two clicks at once add stock once", async () => {
    const w = await world();
    const s = await announce(w);
    const saved = await db.$transaction((tx) => saveDraft(tx, { shipmentId: s.id, user: { id: shopId }, notes: null, finish: false, lines: [line(w.a.id, "24")] }));
    const confirm = () => db.$transaction((tx) => confirmSession(tx, { shipmentId: s.id, sessionId: saved.sessionId, user: { id: shopId } }), { timeout: 30000 });
    const results = await Promise.allSettled([confirm(), confirm()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await stock(w, w.a.id)).toBe("24");

    await expect(db.shipmentReceiving.update({ where: { id: saved.sessionId }, data: { notes: "changed" } })).rejects.toThrow(/cannot be changed/);
    await expect(db.shipmentReceivingItem.deleteMany({ where: { receivingId: saved.sessionId } })).rejects.toThrow(/cannot be changed/);
    await expect(db.shipment.delete({ where: { id: s.id } })).rejects.toThrow(/cannot be deleted/);
    await expect(db.shipmentItem.updateMany({ where: { shipmentId: s.id }, data: { expectedQty: 1 } })).rejects.toThrow(/cannot be edited/);
  });

  it("a cancelled shipment cannot be counted, and one already being counted cannot be cancelled", async () => {
    const w = await world();
    const s1 = await announce(w);
    await db.$transaction((tx) => cancelShipment(tx, { shipmentId: s1.id, user: { id: ownerId }, reason: "Supplier cancelled the order" }));
    await expect(count(s1.id, [line(w.a.id, "24")])).rejects.toBeInstanceOf(ShipmentError);
    expect(await stock(w, w.a.id)).toBe("0");

    const s2 = await announce(w);
    await db.$transaction((tx) => saveDraft(tx, { shipmentId: s2.id, user: { id: shopId }, notes: null, finish: false, lines: [line(w.a.id, "5")] }));
    await expect(db.$transaction((tx) => cancelShipment(tx, { shipmentId: s2.id, user: { id: ownerId }, reason: "too late" }))).rejects.toBeInstanceOf(ShipmentError);
  });

  it("rejects bad counts: wrong unit, fractions of a carton, the same product twice", async () => {
    const w = await world();
    const s = await announce(w);
    const save = (lines: CountLine[]) => db.$transaction((tx) => saveDraft(tx, { shipmentId: s.id, user: { id: shopId }, notes: null, finish: false, lines }));
    await expect(save([line(w.a.id, "1.5", "0", carton)])).rejects.toBeInstanceOf(ShipmentError);
    await expect(save([line(w.a.id, "5", "0", randomUUID())])).rejects.toBeInstanceOf(ShipmentError);
    await expect(save([line(w.a.id, "5"), line(w.a.id, "6")])).rejects.toBeInstanceOf(ShipmentError);
    expect(await stock(w, w.a.id)).toBe("0");
  });

  it("the shop only ever counts quantities; the owner's costs stay on the announcement", async () => {
    const w = await world();
    const s = await announce(w);
    const items = await db.shipmentItem.findMany({ where: { shipmentId: s.id } });
    expect(items[0]!.lineCost!.toString()).toBe("240000");
    expect(D(items[0]!.unitCost!.toString()).toString()).toBe("10000");
  });
});
