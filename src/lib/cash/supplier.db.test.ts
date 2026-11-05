import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { postManualCash } from "./deposits";
import { CashError, accountBalance, getAccount } from "./ledger";
import { getSupplierBalances, paySupplier } from "./supplier";

let userId: string;
let unitId: string;
let categoryId: string;
beforeAll(async () => {
  const role = await db.role.create({ data: { key: `T_${randomUUID()}`, name: "Test role" } });
  userId = (await db.user.create({ data: { username: `t_${randomUUID()}`, name: "Owner", passwordHash: "x", roleId: role.id } })).id;
  unitId = (await db.unit.create({ data: { name: `Bottle ${randomUUID()}`, symbol: randomUUID().slice(0, 8) } })).id;
  categoryId = (await db.category.create({ data: { name: `Cat ${randomUUID()}` } })).id;
});

async function world() {
  const location = await db.location.create({ data: { code: randomUUID().slice(0, 8).toUpperCase(), name: `Loc ${randomUUID()}`, isDefault: false } });
  const supplier = await db.supplier.create({ data: { name: `Supplier ${randomUUID()}` } });
  const product = await db.product.create({ data: { sku: `SKU-${randomUUID()}`, name: "Oil", categoryId, baseUnitId: unitId, purchasePrice: 1, sellingPrice: 2 } });
  const shipment = await db.shipment.create({
    data: {
      shipmentNo: `SHP-T-${randomUUID()}`, supplierId: supplier.id, locationId: location.id, createdById: userId, submissionKey: randomUUID(),
      items: { create: [{ productId: product.id, expectedQty: 10, enteredQty: 10, enteredUnitId: unitId, factor: 1, unitCost: 100000, lineCost: 1000000 }] },
    },
  });
  await db.$transaction((tx) => postManualCash(tx, { user: { id: userId }, locationId: location.id, method: "BANK", kind: "OPENING", amount: "5000000", reason: "", submissionKey: randomUUID(), currencyDecimals: 0 }));
  return { location, supplier, shipment };
}
const pay = (w: Awaited<ReturnType<typeof world>>, amount: string, over: Partial<Parameters<typeof paySupplier>[1]> = {}) =>
  db.$transaction((tx) => paySupplier(tx, { user: { id: userId }, supplierId: w.supplier.id, shipmentId: null, amount, method: "BANK", reference: "TT-1", notes: null, submissionKey: randomUUID(), currencyDecimals: 0, locationId: w.location.id, ...over }), { timeout: 30000 });
const owed = async (w: Awaited<ReturnType<typeof world>>) => (await getSupplierBalances(db)).find((b) => b.id === w.supplier.id)!;

describe("supplier payments", () => {
  it("what we owe is the shipment cost minus what was paid, and each payment leaves the chosen account", async () => {
    const w = await world();
    expect(await owed(w)).toMatchObject({ purchases: 1_000_000, paid: 0, owed: 1_000_000 });
    await pay(w, "400000", { shipmentId: w.shipment.id });
    expect(await owed(w)).toMatchObject({ paid: 400_000, owed: 600_000 });
    const rows = await db.cashTransaction.findMany({ where: { type: "SUPPLIER_PAYMENT", account: { locationId: w.location.id } } });
    expect(rows.map((r) => r.amount.toString())).toEqual(["-400000"]);
    const acct = await db.$transaction((tx) => getAccount(tx, w.location.id, "BANK"));
    expect((await db.$transaction((tx) => accountBalance(tx, acct.id))).toString()).toBe("4600000");
  });

  it("cannot pay more than the account holds, needs a reference for bank/mobile, rejects another supplier's shipment, and a double click pays once", async () => {
    const w = await world();
    await expect(pay(w, "9000000")).rejects.toBeInstanceOf(CashError);
    await expect(pay(w, "1000", { reference: "" })).rejects.toMatchObject({ fieldErrors: { reference: expect.any(String) } });
    const other = await world();
    await expect(pay(w, "1000", { shipmentId: other.shipment.id })).rejects.toMatchObject({ fieldErrors: { shipmentId: expect.any(String) } });
    expect((await owed(w)).paid).toBe(0); // the failed attempts left nothing behind
    const key = randomUUID();
    const results = await Promise.allSettled([pay(w, "100000", { submissionKey: key }), pay(w, "100000", { submissionKey: key })]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect((await owed(w)).paid).toBe(100_000);
    const row = await db.supplierPayment.findFirstOrThrow({ where: { supplierId: w.supplier.id } });
    await expect(db.$executeRaw`UPDATE "SupplierPayment" SET "amount" = 1 WHERE "id" = ${row.id}`).rejects.toThrow(/permanent/);
  });
});
