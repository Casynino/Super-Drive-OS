import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { InsufficientStockError } from "@/lib/inventory/engine";
import { postReceipt } from "@/lib/inventory/documents";
import { resolveLines } from "@/lib/inventory/lines";
import { decideProblem, loadProblems, reportProblem } from "./problems";
import { ShipmentError } from "./engine";

const D = (v: string | number) => new Prisma.Decimal(v);
let userId: string;
let unitBottle: string;
let categoryId: string;

beforeAll(async () => {
  const role = await db.role.create({ data: { key: `T_${randomUUID()}`, name: "Test role" } });
  userId = (await db.user.create({ data: { username: `t_${randomUUID()}`, name: "Keeper", passwordHash: "x", roleId: role.id } })).id;
  unitBottle = (await db.unit.create({ data: { name: `Bottle ${randomUUID()}`, symbol: randomUUID().slice(0, 8) } })).id;
  categoryId = (await db.category.create({ data: { name: `Cat ${randomUUID()}` } })).id;
});

async function warehouse(stock = 100) {
  const location = await db.location.create({ data: { code: randomUUID().slice(0, 8).toUpperCase(), name: `WH ${randomUUID()}` } });
  const product = await db.product.create({ data: { sku: `SKU-${randomUUID()}`, name: "Test oil", categoryId, baseUnitId: unitBottle, purchasePrice: 10000, sellingPrice: 25000, allowPieceSales: true } });
  await db.$transaction(async (tx) => {
    const r = await resolveLines(tx, [{ productId: product.id, unitId: unitBottle, quantity: String(stock) }]);
    if (!r.ok) throw new Error(r.message);
    await postReceipt(tx, { type: "OPENING_STOCK", supplierId: null, locationId: location.id, supplierInvoice: null, receivedDate: new Date(), notes: null, submissionKey: randomUUID(), lines: r.lines.map((l) => ({ ...l, lineTotal: D(stock * 10000) })), user: { id: userId } });
  });
  return { location, product };
}
const qty = async (w: { location: { id: string }; product: { id: string } }, productId = w.product.id) => {
  const b = await db.stockBalance.findUnique({ where: { productId_locationId: { productId, locationId: w.location.id } } });
  return b ? Number(b.quantity) : 0;
};
const report = (w: { location: { id: string }; product: { id: string } }, kind: "DAMAGED" | "MISSING", quantity: string, key = randomUUID(), note = "Found broken on the shelf") =>
  db.$transaction((tx) => reportProblem(tx, { productId: w.product.id, locationId: w.location.id, kind, quantity, note, submissionKey: key, user: { id: userId } }));
const decide = (problemId: string, action: "FOUND" | "WRITE_OFF" | "DISCOUNT_SELL" | "DISMISS", over: { note?: string | null; discountPrice?: string } = {}) =>
  db.$transaction((tx) => decideProblem(tx, { problemId, action, note: over.note ?? null, discountPrice: over.discountPrice, user: { id: userId }, currencyDecimals: 0 }));

describe("problems reported by hand", () => {
  it("takes the pieces off the sellable stock at once and lists the problem as open", async () => {
    const w = await warehouse(100);
    const r = await report(w, "DAMAGED", "6");
    expect(await qty(w)).toBe(94);
    const mv = await db.stockMovement.findFirstOrThrow({ where: { productId: w.product.id, referenceId: r.problem.adjustmentId } });
    expect(mv.type).toBe("DAMAGED");
    expect(Number(mv.quantity)).toBe(-6);
    const { open } = await loadProblems(db);
    expect(open.some((p) => p.id === r.problem.id && p.quantity === 6 && p.action === null)).toBe(true);
  });

  it("a double submit reports once", async () => {
    const w = await warehouse(50);
    const key = randomUUID();
    const a = await report(w, "MISSING", "4", key);
    const b = await report(w, "MISSING", "4", key);
    expect(b.repeated).toBe(true);
    expect(b.problem.id).toBe(a.problem.id);
    expect(await qty(w)).toBe(46);
  });

  it("refuses more than is on the shelf and never touches goods reserved for pickup", async () => {
    const w = await warehouse(10);
    await expect(report(w, "DAMAGED", "11")).rejects.toBeInstanceOf(InsufficientStockError);
    await db.stockBalance.update({ where: { productId_locationId: { productId: w.product.id, locationId: w.location.id } }, data: { reserved: 8 } });
    await expect(report(w, "MISSING", "3")).rejects.toBeInstanceOf(InsufficientStockError); // only 2 are free
    await report(w, "MISSING", "2");
    expect(await qty(w)).toBe(8);
    expect(await db.stockProblem.count({ where: { productId: w.product.id } })).toBe(1);
  });

  it("needs a note and a positive number", async () => {
    const w = await warehouse(10);
    await expect(report(w, "DAMAGED", "0")).rejects.toBeInstanceOf(ShipmentError);
    await expect(report(w, "DAMAGED", "2", randomUUID(), "  ")).rejects.toBeInstanceOf(ShipmentError);
    expect(await qty(w)).toBe(10);
  });

  it("found puts the pieces back, and a problem can be decided only once", async () => {
    const w = await warehouse(20);
    const r = await report(w, "MISSING", "5");
    expect(await qty(w)).toBe(15);
    const d = await decide(r.problem.id, "FOUND");
    expect(await qty(w)).toBe(20);
    expect(d.problem.foundAdjustmentId).toBeTruthy();
    await expect(decide(r.problem.id, "WRITE_OFF", { note: "again" })).rejects.toThrow(/already decided/);
    expect(await qty(w)).toBe(20);
    // the database itself refuses to change or delete a problem
    await expect(db.stockProblem.update({ where: { id: r.problem.id }, data: { decisionNote: "tamper" } })).rejects.toThrow();
    await expect(db.stockProblem.delete({ where: { id: r.problem.id } })).rejects.toThrow();
  });

  it("write off needs a reason, moves no more stock, and disposes the damaged pieces", async () => {
    const w = await warehouse(30);
    const r = await report(w, "DAMAGED", "4");
    await expect(decide(r.problem.id, "WRITE_OFF")).rejects.toBeInstanceOf(ShipmentError);
    const before = await qty(w);
    await decide(r.problem.id, "WRITE_OFF", { note: "Leaking, cannot be sold" });
    expect(await qty(w)).toBe(before);
    const disposed = await db.inventoryItem.count({ where: { productId: w.product.id, status: "DISPOSED" } });
    const damaged = await db.inventoryItem.count({ where: { productId: w.product.id, status: "DAMAGED" } });
    expect(disposed).toBe(4);
    expect(damaged).toBe(0);
  });

  it("a lost problem cannot be sold at a discount", async () => {
    const w = await warehouse(10);
    const r = await report(w, "MISSING", "2");
    await expect(decide(r.problem.id, "DISCOUNT_SELL", { discountPrice: "20000" })).rejects.toBeInstanceOf(ShipmentError);
  });

  it("damaged pieces can go on sale at a lower price as their own product; the normal product is untouched", async () => {
    const w = await warehouse(40);
    const r = await report(w, "DAMAGED", "5");
    await expect(decide(r.problem.id, "DISCOUNT_SELL", { discountPrice: "25000" })).rejects.toBeInstanceOf(ShipmentError); // not lower than normal
    await expect(decide(r.problem.id, "DISCOUNT_SELL", { discountPrice: "" })).rejects.toBeInstanceOf(ShipmentError);
    const d = await decide(r.problem.id, "DISCOUNT_SELL", { discountPrice: "15000" });
    const variant = await db.product.findUniqueOrThrow({ where: { id: d.problem.variantProductId! } });
    expect(variant.sku.endsWith("-DMG")).toBe(true);
    expect(Number(variant.sellingPrice)).toBe(15000);
    expect(await qty(w, variant.id)).toBe(5);
    expect(await qty(w)).toBe(35); // the normal product stays 5 short
    const normal = await db.product.findUniqueOrThrow({ where: { id: w.product.id } });
    expect(Number(normal.sellingPrice)).toBe(25000);
  });

  it("a problem can be removed from the list with a reason: stock and money do not change, nothing is erased", async () => {
    const w = await warehouse(20);
    const r = await report(w, "DAMAGED", "3");
    expect(await qty(w)).toBe(17);
    await expect(decide(r.problem.id, "DISMISS")).rejects.toBeInstanceOf(ShipmentError); // a reason is needed
    const d = await decide(r.problem.id, "DISMISS", { note: "Recorded by mistake" });
    expect(d.problem.action).toBe("DISMISS");
    expect(await qty(w)).toBe(17); // the pieces stay off the shelf
    expect(await db.stockProblem.count({ where: { id: r.problem.id } })).toBe(1); // still there, in the history
    const { open, decided } = await loadProblems(db);
    expect(open.some((p) => p.id === r.problem.id)).toBe(false);
    expect(decided.some((p) => p.id === r.problem.id && p.action === "DISMISS")).toBe(true);
    await expect(decide(r.problem.id, "FOUND")).rejects.toThrow(/already decided/);
  });
});

