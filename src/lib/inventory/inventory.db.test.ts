import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { InsufficientStockError, moveStock, weightedAverage } from "./engine";
import { postAdjustment, postReceipt, postTransfer } from "./documents";
import { resolveLines } from "./lines";

const D = (v: string | number) => new Prisma.Decimal(v);
let userId: string;
let unitBottle: string;
let unitCarton: string;
let categoryId: string;

beforeAll(async () => {
  const role = await db.role.create({ data: { key: `T_${randomUUID()}`, name: "Test role" } });
  userId = (await db.user.create({ data: { username: `t_${randomUUID()}`, email: `t_${randomUUID()}@test.local`, name: "Tester", passwordHash: "x", roleId: role.id } })).id;
  unitBottle = (await db.unit.create({ data: { name: `Bottle ${randomUUID()}`, symbol: randomUUID().slice(0, 8) } })).id;
  unitCarton = (await db.unit.create({ data: { name: `Carton ${randomUUID()}`, symbol: randomUUID().slice(0, 8) } })).id;
  categoryId = (await db.category.create({ data: { name: `Cat ${randomUUID()}` } })).id;
});

async function fixture() {
  const [a, b] = await Promise.all([
    db.location.create({ data: { code: randomUUID().slice(0, 8).toUpperCase(), name: `Loc A ${randomUUID()}` } }),
    db.location.create({ data: { code: randomUUID().slice(0, 8).toUpperCase(), name: `Loc B ${randomUUID()}` } }),
  ]);
  const product = await db.product.create({
    data: {
      sku: `SKU-${randomUUID()}`,
      name: "Test oil",
      categoryId,
      baseUnitId: unitBottle,
      purchasePrice: 100,
      sellingPrice: 150,
      units: { create: [{ unitId: unitCarton, factor: 12 }] },
    },
  });
  return { a, b, product };
}

const qty = async (productId: string, locationId: string) =>
  (await db.stockBalance.findUnique({ where: { productId_locationId: { productId, locationId } } }))?.quantity ?? D(0);

async function receive(productId: string, locationId: string, baseQty: number, lineTotal: number) {
  return db.$transaction(async (tx) => {
    const r = await resolveLines(tx, [{ productId, unitId: unitBottle, quantity: String(baseQty) }]);
    if (!r.ok) throw new Error(r.message);
    return postReceipt(tx, {
      type: "PURCHASE",
      supplierId: null,
      locationId,
      supplierInvoice: null,
      receivedDate: new Date(),
      notes: null,
      submissionKey: randomUUID(),
      lines: r.lines.map((l) => ({ ...l, lineTotal: D(lineTotal) })),
      user: { id: userId },
    });
  });
}

describe("weightedAverage (pure)", () => {
  it("blends old and new cost by quantity", () => {
    expect(weightedAverage(D(10), D(100), D(10), D(200)).toString()).toBe("150");
  });
  it("uses the new cost when nothing is on hand", () => {
    expect(weightedAverage(D(0), D(999), D(5), D(40)).toString()).toBe("40");
  });
});

describe("receiving", () => {
  it("adds stock, records the ledger row, and keeps a weighted-average cost", async () => {
    const { a, product } = await fixture();
    await receive(product.id, a.id, 10, 1000); // 10 @ 100
    await receive(product.id, a.id, 10, 2000); // 10 @ 200

    expect((await qty(product.id, a.id)).toString()).toBe("20");
    const p = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(p.avgCost.toString()).toBe("150");

    const moves = await db.stockMovement.findMany({ where: { productId: product.id }, orderBy: { createdAt: "asc" } });
    expect(moves.map((m) => [m.type, m.previousQty.toString(), m.quantity.toString(), m.newQty.toString()])).toEqual([
      ["RECEIVED", "0", "10", "10"],
      ["RECEIVED", "10", "10", "20"],
    ]);
  });

  it("converts packaging: 2 cartons of 12 adds 24 bottles", async () => {
    const { a, product } = await fixture();
    await db.$transaction(async (tx) => {
      const r = await resolveLines(tx, [{ productId: product.id, unitId: unitCarton, quantity: "2" }]);
      if (!r.ok) throw new Error(r.message);
      await postReceipt(tx, {
        type: "OPENING_STOCK",
        supplierId: null,
        locationId: a.id,
        supplierInvoice: null,
        receivedDate: new Date(),
        notes: null,
        submissionKey: randomUUID(),
        lines: r.lines.map((l) => ({ ...l, lineTotal: D(2400) })),
        user: { id: userId },
      });
    });
    expect((await qty(product.id, a.id)).toString()).toBe("24");
  });

  it("rejects a unit that is not set up for the product and fractions on whole units", async () => {
    const { product } = await fixture();
    const other = await db.unit.create({ data: { name: `Drum ${randomUUID()}`, symbol: randomUUID().slice(0, 8) } });
    const bad = await resolveLines(db, [{ productId: product.id, unitId: other.id, quantity: "1" }]);
    expect(bad.ok).toBe(false);
    const frac = await resolveLines(db, [{ productId: product.id, unitId: unitCarton, quantity: "1.5" }]);
    expect(frac.ok).toBe(false);
  });

  it("a duplicate submission (same key) is rejected and stock is added only once", async () => {
    const { a, product } = await fixture();
    const key = randomUUID();
    const post = () =>
      db.$transaction(async (tx) => {
        const r = await resolveLines(tx, [{ productId: product.id, unitId: unitBottle, quantity: "5" }]);
        if (!r.ok) throw new Error(r.message);
        return postReceipt(tx, {
          type: "PURCHASE",
          supplierId: null,
          locationId: a.id,
          supplierInvoice: null,
          receivedDate: new Date(),
          notes: null,
          submissionKey: key,
          lines: r.lines.map((l) => ({ ...l, lineTotal: D(500) })),
          user: { id: userId },
        });
      });
    const results = await Promise.allSettled([post(), post()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await qty(product.id, a.id)).toString()).toBe("5");
  });
});

describe("stock engine integrity", () => {
  it("never goes negative and leaves no trace when a move is refused", async () => {
    const { a, product } = await fixture();
    await receive(product.id, a.id, 10, 1000);
    const before = await db.stockMovement.count({ where: { productId: product.id } });

    await expect(
      db.$transaction((tx) => moveStock(tx, { productId: product.id, locationId: a.id, type: "SOLD", delta: D(-11), userId })),
    ).rejects.toBeInstanceOf(InsufficientStockError);

    expect((await qty(product.id, a.id)).toString()).toBe("10");
    expect(await db.stockMovement.count({ where: { productId: product.id } })).toBe(before);
  });

  it("25 simultaneous sales of 1 against 10 in stock: exactly 10 succeed, stock ends at 0, ledger adds up", async () => {
    const { a, product } = await fixture();
    await receive(product.id, a.id, 10, 1000);

    const attempts = await Promise.allSettled(
      Array.from({ length: 25 }, () =>
        db.$transaction((tx) => moveStock(tx, { productId: product.id, locationId: a.id, type: "SOLD", delta: D(-1), userId })),
      ),
    );
    expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(10);
    expect(attempts.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason instanceof InsufficientStockError)).toBe(true);

    expect((await qty(product.id, a.id)).toString()).toBe("0");
    const sum = await db.stockMovement.aggregate({ where: { productId: product.id, locationId: a.id }, _sum: { quantity: true } });
    expect(sum._sum.quantity!.toString()).toBe("0"); // +10 received, -10 sold

    // every ledger row chains: previous + quantity = new
    const moves = await db.stockMovement.findMany({ where: { productId: product.id } });
    for (const m of moves) expect(m.previousQty.plus(m.quantity).eq(m.newQty)).toBe(true);
  });

  it("ledger rows cannot be edited or deleted", async () => {
    const { a, product } = await fixture();
    await receive(product.id, a.id, 3, 300);
    const m = await db.stockMovement.findFirstOrThrow({ where: { productId: product.id } });
    await expect(db.stockMovement.update({ where: { id: m.id }, data: { quantity: 99 } })).rejects.toThrow(/append-only/);
    await expect(db.stockMovement.delete({ where: { id: m.id } })).rejects.toThrow(/append-only/);
  });

  it("the database itself refuses a negative balance", async () => {
    const { a, product } = await fixture();
    await receive(product.id, a.id, 1, 100);
    await expect(db.$executeRaw`UPDATE "StockBalance" SET "quantity" = -1 WHERE "productId" = ${product.id}`).rejects.toThrow();
  });
});

describe("transfers", () => {
  it("moves stock between locations and keeps the total", async () => {
    const { a, b, product } = await fixture();
    await receive(product.id, a.id, 10, 1000);
    await db.$transaction(async (tx) => {
      const r = await resolveLines(tx, [{ productId: product.id, unitId: unitBottle, quantity: "4" }]);
      if (!r.ok) throw new Error(r.message);
      await postTransfer(tx, { fromLocationId: a.id, toLocationId: b.id, notes: null, submissionKey: randomUUID(), lines: r.lines, user: { id: userId } });
    });
    expect((await qty(product.id, a.id)).toString()).toBe("6");
    expect((await qty(product.id, b.id)).toString()).toBe("4");
  });

  it("cannot transfer more than is on hand (nothing moves)", async () => {
    const { a, b, product } = await fixture();
    await receive(product.id, a.id, 2, 200);
    await expect(
      db.$transaction(async (tx) => {
        const r = await resolveLines(tx, [{ productId: product.id, unitId: unitBottle, quantity: "3" }]);
        if (!r.ok) throw new Error(r.message);
        await postTransfer(tx, { fromLocationId: a.id, toLocationId: b.id, notes: null, submissionKey: randomUUID(), lines: r.lines, user: { id: userId } });
      }),
    ).rejects.toBeInstanceOf(InsufficientStockError);
    expect((await qty(product.id, a.id)).toString()).toBe("2");
    expect((await qty(product.id, b.id)).toString()).toBe("0");
  });

  it("opposite transfers at the same time do not deadlock and conserve stock", async () => {
    const { a, b, product } = await fixture();
    await receive(product.id, a.id, 50, 5000);
    await receive(product.id, b.id, 50, 5000);
    const move = (from: string, to: string) =>
      db.$transaction(async (tx) => {
        const r = await resolveLines(tx, [{ productId: product.id, unitId: unitBottle, quantity: "1" }]);
        if (!r.ok) throw new Error(r.message);
        await postTransfer(tx, { fromLocationId: from, toLocationId: to, notes: null, submissionKey: randomUUID(), lines: r.lines, user: { id: userId } });
      });
    const jobs = Array.from({ length: 20 }, (_, i) => (i % 2 ? move(a.id, b.id) : move(b.id, a.id)));
    const results = await Promise.allSettled(jobs);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const total = (await qty(product.id, a.id)).plus(await qty(product.id, b.id));
    expect(total.toString()).toBe("100");
  });
});

describe("adjustments and counts", () => {
  const adjust = (kind: "INCREASE" | "DECREASE" | "DAMAGE" | "COUNT", productId: string, locationId: string, quantity: string) =>
    db.$transaction(async (tx) => {
      const r = await resolveLines(tx, [{ productId, unitId: unitBottle, quantity }], { allowZero: kind === "COUNT" });
      if (!r.ok) throw new Error(r.message);
      return postAdjustment(tx, { kind, locationId, reason: "test reason", submissionKey: randomUUID(), lines: r.lines, user: { id: userId } });
    });

  it("damage reduces stock as a DAMAGED movement valued at average cost", async () => {
    const { a, product } = await fixture();
    await receive(product.id, a.id, 10, 1000);
    await adjust("DAMAGE", product.id, a.id, "3");
    expect((await qty(product.id, a.id)).toString()).toBe("7");
    const m = await db.stockMovement.findFirstOrThrow({ where: { productId: product.id, type: "DAMAGED" } });
    expect(m.quantity.toString()).toBe("-3");
    expect(m.unitCost!.toString()).toBe("100");
  });

  it("a stock count posts only the difference as a CORRECTION; a matching count posts none", async () => {
    const { a, product } = await fixture();
    await receive(product.id, a.id, 7, 700);
    const first = await adjust("COUNT", product.id, a.id, "5");
    expect(first.applied).toBe(1);
    expect((await qty(product.id, a.id)).toString()).toBe("5");
    const m = await db.stockMovement.findFirstOrThrow({ where: { productId: product.id, type: "CORRECTION" } });
    expect(m.quantity.toString()).toBe("-2");

    const second = await adjust("COUNT", product.id, a.id, "5");
    expect(second.applied).toBe(0);
    expect(await db.stockMovement.count({ where: { productId: product.id, type: "CORRECTION" } })).toBe(1);
  });

  it("cannot decrease below zero", async () => {
    const { a, product } = await fixture();
    await receive(product.id, a.id, 2, 200);
    await expect(adjust("DECREASE", product.id, a.id, "5")).rejects.toBeInstanceOf(InsufficientStockError);
    expect((await qty(product.id, a.id)).toString()).toBe("2");
  });
});
