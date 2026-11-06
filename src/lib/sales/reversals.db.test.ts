import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { postReceipt } from "@/lib/inventory/documents";
import { resolveLines } from "@/lib/inventory/lines";
import { postCollection, CollectionError } from "./collections";
import { customerOutstanding } from "./outstanding";
import { postSale, type SaleInput } from "./post-sale";
import { getStatement } from "./statement";
import { customerCredit } from "./collections";
import { completeReversal, createReversalRequest, rejectReversal, ReversalError } from "./reversals";

const D = (v: string | number) => new Prisma.Decimal(v);
let cashierId: string;
let managerId: string;
let unitBottle: string;
let categoryId: string;

beforeAll(async () => {
  const role = await db.role.create({ data: { key: `T_${randomUUID()}`, name: "Test role" } });
  cashierId = (await db.user.create({ data: { username: `t_${randomUUID()}`, name: "Cashier", passwordHash: "x", roleId: role.id } })).id;
  managerId = (await db.user.create({ data: { username: `t_${randomUUID()}`, name: "Manager", passwordHash: "x", roleId: role.id } })).id;
  unitBottle = (await db.unit.create({ data: { name: `Bottle ${randomUUID()}`, symbol: randomUUID().slice(0, 8) } })).id;
  categoryId = (await db.category.create({ data: { name: `Cat ${randomUUID()}` } })).id;
});

async function world() {
  const location = await db.location.create({ data: { code: randomUUID().slice(0, 8).toUpperCase(), name: `Loc ${randomUUID()}` } });
  const product = await db.product.create({ data: { sku: `SKU-${randomUUID()}`, name: "Test oil", categoryId, baseUnitId: unitBottle, purchasePrice: 10000, sellingPrice: 25000 } });
  await db.$transaction(async (tx) => {
    const r = await resolveLines(tx, [{ productId: product.id, unitId: unitBottle, quantity: "100" }]);
    if (!r.ok) throw new Error(r.message);
    await postReceipt(tx, { type: "OPENING_STOCK", supplierId: null, locationId: location.id, supplierInvoice: null, receivedDate: new Date(), notes: null, submissionKey: randomUUID(), lines: r.lines.map((l) => ({ ...l, lineTotal: D(1_000_000) })), user: { id: cashierId } });
  });
  const customer = await db.customer.create({ data: { name: `Cust ${randomUUID()}`, phone: "0712 000 111", creditLimit: 10_000_000 } });
  return { location, product, customer };
}
type W = Awaited<ReturnType<typeof world>>;

function sell(w: W, bottles: number, over: Partial<SaleInput> = {}) {
  const input: SaleInput = {
    user: { id: cashierId },
    can: { discount: false, credit: true, approveCreditException: false },
    customerId: null,
    locationId: w.location.id,
    mode: "FULL",
    method: "CASH",
    partAmount: null,
    reference: null,
    notes: null,
    lines: [{ productId: w.product.id, unitId: unitBottle, quantity: String(bottles), unitPrice: "" }],
    creditException: null,
    submissionKey: randomUUID(),
    currencyDecimals: 0,
    creditTermsDays: 30,
    ...over,
  };
  return db.$transaction((tx) => postSale(tx, input), { timeout: 30000 }).then((r) => r.sale);
}

const stock = async (w: W) => (await db.stockBalance.findUnique({ where: { productId_locationId: { productId: w.product.id, locationId: w.location.id } } }))!.quantity.toString();
const reload = (id: string) => db.sale.findUniqueOrThrow({ where: { id } });

async function request(saleId: string, kind: "RETURN" | "CANCEL", lines: { quantity: string; condition?: "RESELLABLE" | "DAMAGED" }[] = [], over: { refundMethod?: "CASH" | null; reason?: string } = {}) {
  const items = await db.saleItem.findMany({ where: { saleId }, orderBy: { id: "asc" } });
  return db.$transaction((tx) =>
    createReversalRequest(tx, {
      user: { id: cashierId },
      saleId,
      kind,
      reason: over.reason ?? "Customer changed his mind",
      refundMethod: over.refundMethod === undefined ? "CASH" : over.refundMethod,
      refundReference: null,
      lines: lines.map((l, i) => ({ saleItemId: items[i]!.id, quantity: l.quantity, condition: l.condition ?? "RESELLABLE" })),
      submissionKey: randomUUID(),
    }),
  );
}
const approve = (reversalId: string) => db.$transaction((tx) => completeReversal(tx, { reversalId, approver: { id: managerId }, dp: 0 }), { timeout: 30000 });

describe("returns on a paid cash sale", () => {
  it("a partial return puts stock back, refunds the cash, and leaves the sale paid in full", async () => {
    const w = await world();
    const sale = await sell(w, 4); // 100000 cash
    expect(await stock(w)).toBe("96");

    const r = await approve((await request(sale.id, "RETURN", [{ quantity: "1" }])).id);
    expect(r.returnValue.toString()).toBe("25000");
    expect(r.refund.toString()).toBe("25000");

    const s = await reload(sale.id);
    expect([s.returnedTotal.toString(), s.refundedTotal.toString(), s.status, s.paymentStatus, s.total.toString(), s.amountPaid.toString()]).toEqual(["25000", "25000", "COMPLETED", "PAID", "100000", "100000"]);
    expect(await stock(w)).toBe("97");
    const m = await db.stockMovement.findFirstOrThrow({ where: { type: "CUSTOMER_RETURN", referenceId: r.reversal.id } });
    expect([m.quantity.toString(), m.unitCost!.toString()]).toEqual(["1", "10000"]);
  });

  it("returning the rest cancels the sale, restores all stock and refunds everything", async () => {
    const w = await world();
    const sale = await sell(w, 4);
    await approve((await request(sale.id, "RETURN", [{ quantity: "1" }])).id);
    const last = await approve((await request(sale.id, "RETURN", [{ quantity: "3" }])).id);
    expect(last.saleCancelled).toBe(true);
    const s = await reload(sale.id);
    expect([s.status, s.returnedTotal.toString(), s.refundedTotal.toString()]).toEqual(["CANCELLED", "100000", "100000"]);
    expect(await stock(w)).toBe("100");
    await expect(request(sale.id, "RETURN", [{ quantity: "1" }])).rejects.toBeInstanceOf(ReversalError); // nothing left to return
  });

  it("cancelling a whole sale undoes it in one step", async () => {
    const w = await world();
    const sale = await sell(w, 5);
    const r = await approve((await request(sale.id, "CANCEL")).id);
    expect(r.saleCancelled).toBe(true);
    expect(r.refund.toString()).toBe("125000");
    expect(await stock(w)).toBe("100");
    expect((await reload(sale.id)).status).toBe("CANCELLED");
  });
});

describe("returns on credit sales", () => {
  it("a return on an unpaid invoice just lowers what is owed (no refund)", async () => {
    const w = await world();
    const sale = await sell(w, 12, { customerId: w.customer.id, mode: "CREDIT", method: null }); // 300000 owed
    const r = await approve((await request(sale.id, "RETURN", [{ quantity: "4" }], { refundMethod: null })).id);
    expect(r.refund.toString()).toBe("0");
    expect((await customerOutstanding(db, w.customer.id)).toString()).toBe("200000");
    expect((await reload(sale.id)).paymentStatus).toBe("UNPAID");
  });

  it("when the customer already paid more than the reduced invoice, only the excess is refunded", async () => {
    const w = await world();
    const sale = await sell(w, 12, { customerId: w.customer.id, mode: "PART", method: "CASH", partAmount: "200000" }); // 300000, paid 200000
    const r = await approve((await request(sale.id, "RETURN", [{ quantity: "8" }])).id); // worth 200000 -> invoice now 100000
    expect(r.refund.toString()).toBe("100000"); // paid 200000, now owes only 100000
    const s = await reload(sale.id);
    expect([s.paymentStatus, s.returnedTotal.toString(), s.refundedTotal.toString()]).toEqual(["PAID", "200000", "100000"]);
    expect((await customerOutstanding(db, w.customer.id)).toString()).toBe("0");
  });

  it("a collection can never exceed what is still owed after a return", async () => {
    const w = await world();
    const sale = await sell(w, 12, { customerId: w.customer.id, mode: "PART", method: "CASH", partAmount: "100000" });
    await approve((await request(sale.id, "RETURN", [{ quantity: "4" }], { refundMethod: null })).id); // invoice 200000, paid 100000 -> owes 100000
    const pay = (amount: number) =>
      db.$transaction((tx) => postCollection(tx, { user: { id: cashierId }, customerId: w.customer.id, method: "CASH", amount: String(amount), reference: null, notes: null, allocations: [{ saleId: sale.id, amount: String(amount) }], keepExtraAsCredit: false, submissionKey: randomUUID(), currencyDecimals: 0 }));
    await expect(pay(100001)).rejects.toBeInstanceOf(CollectionError);
    await pay(100000);
    expect((await reload(sale.id)).paymentStatus).toBe("PAID");
  });
});

describe("damaged returns", () => {
  it("come back and are written off: sellable stock does not change, the ledger shows both steps", async () => {
    const w = await world();
    const sale = await sell(w, 4);
    const r = await approve((await request(sale.id, "RETURN", [{ quantity: "2", condition: "DAMAGED" }])).id);
    expect(await stock(w)).toBe("96"); // nothing went back on the shelf
    const types = (await db.stockMovement.findMany({ where: { referenceId: r.reversal.id }, orderBy: { createdAt: "asc" } })).map((m) => m.type);
    expect(types).toEqual(["CUSTOMER_RETURN", "DAMAGED"]);
    const item = await db.reversalItem.findFirstOrThrow({ where: { reversalId: r.reversal.id } });
    expect([item.returnValue.toString(), item.costValue.toString()]).toEqual(["50000", "0"]); // customer is credited, cost is not restored
    expect(r.refund.toString()).toBe("50000");
  });
});

describe("rules", () => {
  it("refuses over-returns, double-requests and a missing reason", async () => {
    const w = await world();
    const sale = await sell(w, 4);
    await expect(request(sale.id, "RETURN", [{ quantity: "5" }])).rejects.toBeInstanceOf(ReversalError); // more than sold
    await expect(request(sale.id, "RETURN", [{ quantity: "1" }], { reason: "no" })).rejects.toBeInstanceOf(ReversalError);
    await request(sale.id, "RETURN", [{ quantity: "3" }]); // waiting for approval
    await expect(request(sale.id, "RETURN", [{ quantity: "2" }])).rejects.toBeInstanceOf(ReversalError); // 3 + 2 > 4
  });

  it("will not complete a refund without a refund method", async () => {
    const w = await world();
    const sale = await sell(w, 4);
    const req = await request(sale.id, "RETURN", [{ quantity: "1" }], { refundMethod: null });
    await expect(approve(req.id)).rejects.toBeInstanceOf(ReversalError);
    expect((await reload(sale.id)).returnedTotal.toString()).toBe("0"); // nothing happened
    expect(await stock(w)).toBe("96");
  });

  it("an out-of-date request (items already returned meanwhile) is refused at approval", async () => {
    const w = await world();
    const sale = await sell(w, 4);
    await approve((await request(sale.id, "RETURN", [{ quantity: "3" }])).id);
    // sneak in a stale request that the request-time check never saw
    const item = await db.saleItem.findFirstOrThrow({ where: { saleId: sale.id } });
    const stale = await db.saleReversal.create({
      data: { reversalNo: `X-${randomUUID()}`, saleId: sale.id, kind: "RETURN", reason: "stale request", refundMethod: "CASH", requestedById: cashierId, submissionKey: randomUUID(), items: { create: [{ saleItemId: item.id, productId: item.productId, enteredQty: 3, factor: 1, quantity: 3, condition: "RESELLABLE" }] } },
    });
    await expect(approve(stale.id)).rejects.toBeInstanceOf(ReversalError);
    expect(await stock(w)).toBe("99");
  });

  it("a rejected request changes nothing and cannot be approved afterwards; a decision cannot be repeated", async () => {
    const w = await world();
    const sale = await sell(w, 4);
    const req = await request(sale.id, "RETURN", [{ quantity: "1" }]);
    await db.$transaction((tx) => rejectReversal(tx, { reversalId: req.id, approver: { id: managerId }, note: "Not our product" }));
    expect((await reload(sale.id)).returnedTotal.toString()).toBe("0");
    await expect(approve(req.id)).rejects.toBeInstanceOf(ReversalError);

    const req2 = await request(sale.id, "RETURN", [{ quantity: "1" }]);
    await approve(req2.id);
    await expect(approve(req2.id)).rejects.toBeInstanceOf(ReversalError);
  });

  it("two managers approving the same request at the same moment: it happens once", async () => {
    const w = await world();
    const sale = await sell(w, 4);
    const req = await request(sale.id, "RETURN", [{ quantity: "2" }]);
    const results = await Promise.allSettled([approve(req.id), approve(req.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await stock(w)).toBe("98");
    expect((await reload(sale.id)).returnedTotal.toString()).toBe("50000");
  });
});

describe("database protection", () => {
  it("credit-note totals only grow, status cannot be faked, decided requests are frozen and nothing is deleted", async () => {
    const w = await world();
    const sale = await sell(w, 4);
    const r = await approve((await request(sale.id, "RETURN", [{ quantity: "1" }])).id);

    await expect(db.sale.update({ where: { id: sale.id }, data: { returnedTotal: 0, refundedTotal: 0 } })).rejects.toThrow();
    await expect(db.sale.update({ where: { id: sale.id }, data: { status: "CANCELLED" } })).rejects.toThrow();
    await expect(db.saleReversal.update({ where: { id: r.reversal.id }, data: { reason: "changed" } })).rejects.toThrow(/already/);
    await expect(db.saleReversal.delete({ where: { id: r.reversal.id } })).rejects.toThrow(/cannot be deleted/);
    await expect(db.reversalItem.deleteMany({ where: { reversalId: r.reversal.id } })).rejects.toThrow(/cannot be deleted/);
  });
});

describe("customer statement with returns", () => {
  it("shows the return and the refund, and still ends on exactly what the customer owes", async () => {
    const w = await world();
    const sale = await sell(w, 12, { customerId: w.customer.id, mode: "PART", method: "CASH", partAmount: "200000" }); // 300000, paid 200000
    await approve((await request(sale.id, "RETURN", [{ quantity: "8" }])).id); // goods worth 200000 come back, 100000 refunded
    const cancelled = await sell(w, 2, { customerId: w.customer.id });
    await approve((await request(cancelled.id, "CANCEL")).id); // a whole paid sale cancelled

    const st = await getStatement(db, w.customer.id);
    const kinds = st.lines.map((l) => l.kind);
    expect(kinds).toContain("RETURN");
    expect(kinds).toContain("REFUND");
    const owed = await customerOutstanding(db, w.customer.id);
    const credit = await customerCredit(db, w.customer.id);
    expect(owed.minus(credit).toString()).toBe(st.closing.toString());
    expect(st.closing.toString()).toBe("0");
  });
});
