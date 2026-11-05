import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { InsufficientStockError } from "@/lib/inventory/engine";
import { postReceipt } from "@/lib/inventory/documents";
import { resolveLines } from "@/lib/inventory/lines";
import { postCollection } from "@/lib/sales/collections";
import { customerOutstanding } from "@/lib/sales/outstanding";
import { completeReversal, createReversalRequest } from "@/lib/sales/reversals";
import { SaleError } from "@/lib/sales/post-sale";
import { ResellerError, createReseller, getResellerAccount, issueStock, reportSold, returnStock } from "./engine";

const D = (v: string | number) => new Prisma.Decimal(v);
let userId: string;
let managerId: string;
let unitBottle: string;
let categoryId: string;

beforeAll(async () => {
  const role = await db.role.create({ data: { key: `T_${randomUUID()}`, name: "Test role" } });
  userId = (await db.user.create({ data: { username: `t_${randomUUID()}`, name: "Attendant", passwordHash: "x", roleId: role.id } })).id;
  managerId = (await db.user.create({ data: { username: `t_${randomUUID()}`, name: "Manager", passwordHash: "x", roleId: role.id } })).id;
  unitBottle = (await db.unit.create({ data: { name: `Bottle ${randomUUID()}`, symbol: randomUUID().slice(0, 8) } })).id;
  categoryId = (await db.category.create({ data: { name: `Cat ${randomUUID()}` } })).id;
});

async function setup(opts: { settlementDays?: string } = {}) {
  const shop = await db.location.create({ data: { code: randomUUID().slice(0, 8).toUpperCase(), name: `Shop ${randomUUID()}`, type: "SHOP" } });
  const product = await db.product.create({ data: { sku: `SKU-${randomUUID()}`, name: "Oil 5L", categoryId, baseUnitId: unitBottle, purchasePrice: 10000, sellingPrice: 25000, wholesalePrice: 22000 } });
  await db.$transaction(async (tx) => {
    const r = await resolveLines(tx, [{ productId: product.id, unitId: unitBottle, quantity: "100" }]);
    if (!r.ok) throw new Error(r.message);
    await postReceipt(tx, { type: "OPENING_STOCK", supplierId: null, locationId: shop.id, supplierInvoice: null, receivedDate: new Date(), notes: null, submissionKey: randomUUID(), lines: r.lines.map((l) => ({ ...l, lineTotal: D(1_000_000) })), user: { id: userId } });
  });
  const reseller = await db.$transaction((tx) => createReseller(tx, { user: { id: userId }, name: "John Mushi", businessName: "Mushi Traders", phone: "0712345678", altPhone: "", address: "", salesLocation: "Mwenge", idInfo: "", notes: "", settlementDays: opts.settlementDays ?? "14" }));
  return { shop, product, reseller };
}
type W = Awaited<ReturnType<typeof setup>>;

const balance = async (productId: string, locationId: string) => (await db.stockBalance.findUnique({ where: { productId_locationId: { productId, locationId } } }))?.quantity.toString() ?? "0";
const issue = (w: W, qty: number, key = randomUUID()) =>
  db.$transaction((tx) => issueStock(tx, { user: { id: userId }, resellerId: w.reseller.id, fromLocationId: w.shop.id, lines: [{ productId: w.product.id, unitId: unitBottle, quantity: String(qty) }], notes: null, submissionKey: key, currencyDecimals: 0 }), { timeout: 30000 });
const report = (w: W, qty: number, over: { unitPrice?: string; canDiscount?: boolean; discountReason?: string | null; key?: string } = {}) =>
  db.$transaction((tx) => reportSold(tx, { user: { id: userId }, canDiscount: over.canDiscount ?? false, resellerId: w.reseller.id, lines: [{ productId: w.product.id, unitId: unitBottle, quantity: String(qty), unitPrice: over.unitPrice }], discountReason: over.discountReason ?? null, notes: null, submissionKey: over.key ?? randomUUID(), currencyDecimals: 0 }), { timeout: 30000 });
const giveBack = (w: W, qty: number, condition: "RESELLABLE" | "DAMAGED") =>
  db.$transaction((tx) => returnStock(tx, { user: { id: userId }, resellerId: w.reseller.id, toLocationId: w.shop.id, lines: [{ productId: w.product.id, unitId: unitBottle, quantity: String(qty), condition }], notes: null, submissionKey: randomUUID() }), { timeout: 30000 });
const account = (w: W) => getResellerAccount(db, w.reseller.id);

describe("registering a reseller", () => {
  it("creates the profile, an account for their invoices and a custody location that is kept off the shop pickers", async () => {
    const w = await setup();
    const r = await db.reseller.findUniqueOrThrow({ where: { id: w.reseller.id }, include: { customer: true, location: true } });
    expect(r.customer.type).toBe("WHOLESALE");
    expect(r.customer.creditLimit.toString()).toBe("0");
    expect(r.location.type).toBe("RESELLER");
    await expect(db.$transaction((tx) => createReseller(tx, { user: { id: userId }, name: "J", businessName: "", phone: "1", altPhone: "", address: "", salesLocation: "", idInfo: "", notes: "", settlementDays: "-3" }))).rejects.toBeInstanceOf(ResellerError);
    await expect(db.$executeRaw`DELETE FROM "Reseller" WHERE "id" = ${w.reseller.id}`).rejects.toThrow(/cannot be deleted/);
  });
});

describe("issuing stock is a custody transfer, not a sale", () => {
  it("moves the stock off the shelf into custody, records the agreed prices, and creates no sale, no cash and no debt", async () => {
    const w = await setup();
    const { issue: doc } = await issue(w, 20);
    expect(await balance(w.product.id, w.shop.id)).toBe("80");
    expect(await balance(w.product.id, w.reseller.locationId)).toBe("20");
    expect(doc.expectedValue.toString()).toBe("440000"); // 20 x wholesale 22000
    const item = await db.resellerIssueItem.findFirstOrThrow({ where: { issueId: doc.id } });
    expect([item.unitPrice.toString(), item.basePrice.toString(), item.lineValue.toString()]).toEqual(["22000", "22000", "440000"]);
    expect(await db.sale.count({ where: { OR: [{ resellerId: w.reseller.id }, { customerId: w.reseller.customerId }] } })).toBe(0);
    expect(await db.cashTransaction.count({ where: { account: { locationId: { in: [w.shop.id, w.reseller.locationId] } } } })).toBe(0);
    expect((await db.$transaction((tx) => customerOutstanding(tx, w.reseller.customerId))).toString()).toBe("0");
    const total = await db.stockBalance.aggregate({ where: { productId: w.product.id }, _sum: { quantity: true } });
    expect(total._sum.quantity!.toString()).toBe("100"); // the business still owns everything
    await expect(db.$executeRaw`UPDATE "ResellerIssue" SET "expectedValue" = 1 WHERE "id" = ${doc.id}`).rejects.toThrow(/permanent/);
  });

  it("refuses more than the shop has (nothing is recorded) and ignores a double-submitted form", async () => {
    const w = await setup();
    await expect(issue(w, 101)).rejects.toBeInstanceOf(InsufficientStockError);
    expect(await db.resellerIssue.count({ where: { resellerId: w.reseller.id } })).toBe(0);
    expect(await balance(w.product.id, w.shop.id)).toBe("100");
    const key = randomUUID();
    const results = await Promise.allSettled([issue(w, 5, key), issue(w, 5, key)]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(await balance(w.product.id, w.reseller.locationId)).toBe("5");
  });

  it("will not issue a product that has no selling price, or to a deactivated reseller", async () => {
    const w = await setup();
    await db.product.update({ where: { id: w.product.id }, data: { sellingPrice: 0, wholesalePrice: null } });
    await expect(issue(w, 1)).rejects.toMatchObject({ fieldErrors: { "line.0": expect.stringContaining("No selling price") } });
    await db.product.update({ where: { id: w.product.id }, data: { sellingPrice: 25000, wholesalePrice: 22000 } });
    await db.reseller.update({ where: { id: w.reseller.id }, data: { status: "INACTIVE" } });
    await expect(issue(w, 1)).rejects.toThrow(/deactivated/);
  });
});

describe("what the reseller sold", () => {
  it("invoices it on their account at the agreed price (even if the list price changed), from their custody, and takes no cash", async () => {
    const w = await setup();
    await issue(w, 20);
    await db.product.update({ where: { id: w.product.id }, data: { wholesalePrice: 30000, sellingPrice: 35000 } }); // the list price goes up afterwards
    const { sale } = await report(w, 12);
    expect(sale.channel).toBe("RESELLER");
    expect(sale.resellerId).toBe(w.reseller.id);
    expect(sale.locationId).toBe(w.reseller.locationId);
    expect(sale.total.toString()).toBe("264000"); // 12 x the agreed 22000
    expect(sale.paymentStatus).toBe("UNPAID");
    expect(await balance(w.product.id, w.reseller.locationId)).toBe("8");
    expect(await balance(w.product.id, w.shop.id)).toBe("80"); // the shop shelf is not touched again
    expect(await db.cashTransaction.count({ where: { account: { locationId: { in: [w.shop.id, w.reseller.locationId] } } } })).toBe(0);
    expect((await db.$transaction((tx) => customerOutstanding(tx, w.reseller.customerId))).toString()).toBe("264000");
    const due = sale.dueDate!.toISOString().slice(0, 10);
    expect(due >= new Date().toISOString().slice(0, 10)).toBe(true);
  });

  it("cannot report more than the reseller holds, or something never issued; a double-submitted report counts once", async () => {
    const w = await setup();
    await issue(w, 5);
    await expect(report(w, 6)).rejects.toBeInstanceOf(InsufficientStockError);
    const other = await db.product.create({ data: { sku: `SKU-${randomUUID()}`, name: "Never issued", categoryId, baseUnitId: unitBottle, purchasePrice: 1, sellingPrice: 100 } });
    await expect(db.$transaction((tx) => reportSold(tx, { user: { id: userId }, canDiscount: false, resellerId: w.reseller.id, lines: [{ productId: other.id, unitId: unitBottle, quantity: "1" }], discountReason: null, notes: null, submissionKey: randomUUID(), currencyDecimals: 0 }))).rejects.toBeInstanceOf(SaleError);
    const key = randomUUID();
    const results = await Promise.allSettled([report(w, 2, { key }), report(w, 2, { key })]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(await balance(w.product.id, w.reseller.locationId)).toBe("3");
  });

  it("a lower price needs permission and a reason, and is recorded as a discount; a higher price is refused", async () => {
    const w = await setup();
    await issue(w, 10);
    await expect(report(w, 1, { unitPrice: "20000" })).rejects.toBeInstanceOf(SaleError); // not allowed to discount
    await expect(report(w, 1, { unitPrice: "20000", canDiscount: true })).rejects.toBeInstanceOf(SaleError); // no reason
    await expect(report(w, 1, { unitPrice: "23000", canDiscount: true, discountReason: "x y z" })).rejects.toBeInstanceOf(SaleError); // above the agreed price
    const { sale } = await report(w, 2, { unitPrice: "20000", canDiscount: true, discountReason: "Owner agreed a lower price for the bulk" });
    expect([sale.total.toString(), sale.discountTotal.toString()]).toEqual(["40000", "4000"]);
  });
});

describe("collections, returns and the account", () => {
  it("money brought in is a normal payment allocated to the reports, and it lands in the cash ledger", async () => {
    const w = await setup();
    await issue(w, 20);
    const { sale } = await report(w, 10); // 220000
    const res = await db.$transaction((tx) =>
      postCollection(tx, { user: { id: userId }, customerId: w.reseller.customerId, method: "MOBILE_MONEY", amount: "100000", reference: "MM-9", notes: null, allocations: [{ saleId: sale.id, amount: "100000" }], keepExtraAsCredit: false, submissionKey: randomUUID(), currencyDecimals: 0 }),
    );
    const a = await account(w);
    expect([a.collected.toString(), a.outstanding.toString(), a.soldValue.toString()]).toEqual(["100000", "120000", "220000"]);
    expect(a.lastPaymentAt).not.toBeNull();
    const rows = await db.cashTransaction.findMany({ where: { referenceId: res.payment.id }, include: { account: true } });
    expect(rows.map((r) => [r.type, r.account.method, r.account.locationId === w.reseller.locationId])).toEqual([["COLLECTION", "MOBILE_MONEY", true]]);
  });

  it("good goods go back on the shelf, damaged ones are written off from custody, and nobody can return what they do not hold", async () => {
    const w = await setup();
    await issue(w, 10);
    await report(w, 3);
    await giveBack(w, 4, "RESELLABLE");
    await giveBack(w, 1, "DAMAGED");
    expect(await balance(w.product.id, w.reseller.locationId)).toBe("2");
    expect(await balance(w.product.id, w.shop.id)).toBe("94"); // 90 + 4
    const dmg = await db.stockMovement.findFirstOrThrow({ where: { productId: w.product.id, locationId: w.reseller.locationId, type: "DAMAGED" } });
    expect(dmg.quantity.toString()).toBe("-1");
    await expect(giveBack(w, 3, "RESELLABLE")).rejects.toBeInstanceOf(InsufficientStockError);
    expect(await balance(w.product.id, w.reseller.locationId)).toBe("2");
  });

  it("issued = sold + returned + still with the reseller, always; a reversed report puts the goods back in custody", async () => {
    const w = await setup();
    await issue(w, 20);
    const { sale } = await report(w, 8);
    await giveBack(w, 5, "RESELLABLE");
    await giveBack(w, 1, "DAMAGED");
    let a = await account(w);
    expect([a.issuedQty, a.soldQty, a.returnedQty, a.remainingQty].map(String)).toEqual(["20", "8", "6", "6"]);
    expect(a.issuedQty.minus(a.soldQty).minus(a.returnedQty).eq(a.remainingQty)).toBe(true);

    const items = await db.saleItem.findMany({ where: { saleId: sale.id } });
    const req = await db.$transaction((tx) => createReversalRequest(tx, { user: { id: userId }, saleId: sale.id, kind: "RETURN", reason: "Customer returned two bottles", refundMethod: null, refundReference: null, lines: [{ saleItemId: items[0]!.id, quantity: "2", condition: "RESELLABLE" }], submissionKey: randomUUID() }));
    await db.$transaction((tx) => completeReversal(tx, { reversalId: req.id, approver: { id: managerId }, dp: 0 }), { timeout: 30000 });
    a = await account(w);
    expect([a.soldQty, a.remainingQty].map(String)).toEqual(["6", "8"]); // the two bottles are back in custody and no longer count as sold
    expect(a.issuedQty.minus(a.soldQty).minus(a.returnedQty).eq(a.remainingQty)).toBe(true);
    expect(a.soldValue.toString()).toBe("132000"); // 6 x 22000
    expect(await balance(w.product.id, w.reseller.locationId)).toBe("8");
  });
});
