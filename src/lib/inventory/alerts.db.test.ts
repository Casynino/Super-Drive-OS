import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { notifyStockCrossings } from "./alerts";
import { moveStock } from "./engine";

const D = (v: number) => new Prisma.Decimal(v);
let ownerId: string;
let unitId: string;
let categoryId: string;

beforeAll(async () => {
  const role = await db.role.create({ data: { key: `OWN_${randomUUID()}`, name: "Owner test role", isSuperAdmin: true } });
  ownerId = (await db.user.create({ data: { username: `o_${randomUUID()}`, email: `o_${randomUUID()}@test.local`, name: "Owner", passwordHash: "x", roleId: role.id } })).id;
  unitId = (await db.unit.create({ data: { name: `Bottle ${randomUUID()}`, symbol: randomUUID().slice(0, 8) } })).id;
  categoryId = (await db.category.create({ data: { name: `Cat ${randomUUID()}` } })).id;
});

async function take(productId: string, locationId: string, qty: number) {
  await db.$transaction(async (tx) => {
    await moveStock(tx, { productId, locationId, type: "SOLD", delta: D(-qty), unitCost: D(1), referenceType: "Test", referenceId: randomUUID(), referenceNo: "T", userId: ownerId });
    await notifyStockCrossings(tx, [{ productId, qty: D(qty) }], "test");
  });
}
const notes = (name: string) => db.notification.findMany({ where: { userId: ownerId, title: { contains: name } }, orderBy: { createdAt: "asc" } });

describe("low-stock notifications", () => {
  it("fire once when stock crosses the minimum, once when it runs out, and not while it merely keeps falling", async () => {
    const name = `Oil ${randomUUID()}`;
    const loc = await db.location.create({ data: { code: randomUUID().slice(0, 8).toUpperCase(), name: `Loc ${randomUUID()}` } });
    const p = await db.product.create({ data: { sku: `SKU-${randomUUID()}`, name, categoryId, baseUnitId: unitId, purchasePrice: 1, sellingPrice: 2, minStock: 5 } });
    await db.stockBalance.create({ data: { productId: p.id, locationId: loc.id, quantity: 10 } });

    await take(p.id, loc.id, 4); // 6 left: still above the minimum
    expect(await notes(name)).toHaveLength(0);
    await take(p.id, loc.id, 2); // 4 left: crossed
    let n = await notes(name);
    expect(n).toHaveLength(1);
    expect(n[0]!.type).toBe("stock.low");
    await take(p.id, loc.id, 1); // 3 left: already low, no new message
    expect(await notes(name)).toHaveLength(1);
    await take(p.id, loc.id, 3); // gone
    n = await notes(name);
    expect(n.map((x) => x.type)).toEqual(["stock.low", "stock.out"]);
  });

  it("ignores stock held by resellers: it is not on the shelf", async () => {
    const name = `Oil ${randomUUID()}`;
    const shelf = await db.location.create({ data: { code: randomUUID().slice(0, 8).toUpperCase(), name: `Loc ${randomUUID()}` } });
    const away = await db.location.create({ data: { code: randomUUID().slice(0, 8).toUpperCase(), name: `Res ${randomUUID()}`, type: "RESELLER" } });
    const p = await db.product.create({ data: { sku: `SKU-${randomUUID()}`, name, categoryId, baseUnitId: unitId, purchasePrice: 1, sellingPrice: 2, minStock: 5 } });
    await db.stockBalance.createMany({ data: [{ productId: p.id, locationId: shelf.id, quantity: 8 }, { productId: p.id, locationId: away.id, quantity: 50 }] });
    await take(p.id, shelf.id, 8); // the shelf is empty even though a reseller holds plenty
    expect((await notes(name)).map((x) => x.type)).toEqual(["stock.out"]);
  });
});
