import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { InsufficientStockError } from "@/lib/inventory/engine";
import { postReceipt } from "@/lib/inventory/documents";
import { resolveLines } from "@/lib/inventory/lines";
import { customerOutstanding } from "./outstanding";
import { CreditLimitError, SaleError, postSale, type SaleInput } from "./post-sale";

const D = (v: string | number) => new Prisma.Decimal(v);
let userId: string;
let approverId: string;
let unitBottle: string;
let unitCarton: string;
let categoryId: string;

beforeAll(async () => {
  const role = await db.role.create({ data: { key: `T_${randomUUID()}`, name: "Test role" } });
  userId = (await db.user.create({ data: { username: `t_${randomUUID()}`, name: "Cashier", passwordHash: "x", roleId: role.id } })).id;
  approverId = (await db.user.create({ data: { username: `t_${randomUUID()}`, name: "Manager", passwordHash: "x", roleId: role.id } })).id;
  unitBottle = (await db.unit.create({ data: { name: `Bottle ${randomUUID()}`, symbol: randomUUID().slice(0, 8) } })).id;
  unitCarton = (await db.unit.create({ data: { name: `Carton ${randomUUID()}`, symbol: randomUUID().slice(0, 8) } })).id;
  categoryId = (await db.category.create({ data: { name: `Cat ${randomUUID()}` } })).id;
});

async function fixture(stock = 100, cost = 10000) {
  const location = await db.location.create({ data: { code: randomUUID().slice(0, 8).toUpperCase(), name: `Loc ${randomUUID()}` } });
  const product = await db.product.create({
    data: {
      sku: `SKU-${randomUUID()}`,
      name: "Test oil",
      categoryId,
      baseUnitId: unitBottle,
      purchasePrice: cost,
      sellingPrice: 25000,
      wholesalePrice: 22000,
      allowPieceSales: true,
      units: { create: [{ unitId: unitCarton, factor: 12 }] },
    },
  });
  if (stock > 0) {
    await db.$transaction(async (tx) => {
      const r = await resolveLines(tx, [{ productId: product.id, unitId: unitBottle, quantity: String(stock) }]);
      if (!r.ok) throw new Error(r.message);
      await postReceipt(tx, {
        type: "OPENING_STOCK",
        supplierId: null,
        locationId: location.id,
        supplierInvoice: null,
        receivedDate: new Date(),
        notes: null,
        submissionKey: randomUUID(),
        lines: r.lines.map((l) => ({ ...l, lineTotal: D(stock * cost) })),
        user: { id: userId },
      });
    });
  }
  return { location, product };
}

const newCustomer = (data: Partial<Prisma.CustomerUncheckedCreateInput> = {}) =>
  db.customer.create({ data: { name: `Cust ${randomUUID()}`, ...data } });

const qty = async (productId: string, locationId: string) =>
  (await db.stockBalance.findUnique({ where: { productId_locationId: { productId, locationId } } }))?.quantity ?? D(0);

function sell(f: { location: { id: string }; product: { id: string } }, over: Partial<SaleInput> = {}) {
  const input: SaleInput = {
    user: { id: userId },
    can: { discount: false, credit: true, approveCreditException: false },
    customerId: null,
    locationId: f.location.id,
    mode: "FULL",
    method: "CASH",
    partAmount: null,
    reference: null,
    notes: null,
    lines: [{ productId: f.product.id, unitId: unitBottle, quantity: "1", unitPrice: "" }],
    creditException: null,
    submissionKey: randomUUID(),
    currencyDecimals: 0,
    creditTermsDays: 30,
    ...over,
  };
  return db.$transaction((tx) => postSale(tx, input), { timeout: 30000 });
}

async function allocated(saleId: string) {
  const a = await db.paymentAllocation.aggregate({ where: { saleId }, _sum: { amount: true } });
  return a._sum.amount ?? D(0);
}

describe("cash sales", () => {
  it("2 cartons deduct 24 bottles, snapshot cost, and are fully paid by one payment", async () => {
    const f = await fixture();
    const { sale, payment } = await sell(f, { lines: [{ productId: f.product.id, unitId: unitCarton, quantity: "2", unitPrice: "" }] });

    expect(sale.total.toString()).toBe("600000"); // 2 x (12 x 25000)
    expect(sale.paymentStatus).toBe("PAID");
    expect(sale.amountPaid.toString()).toBe("600000");
    expect(sale.cogsTotal.toString()).toBe("240000"); // 24 x 10000
    expect((await qty(f.product.id, f.location.id)).toString()).toBe("76");

    const move = await db.stockMovement.findFirstOrThrow({ where: { referenceType: "Sale", referenceId: sale.id } });
    expect([move.type, move.quantity.toString(), move.previousQty.toString(), move.newQty.toString(), move.unitCost!.toString()]).toEqual(["SOLD", "-24", "100", "76", "10000"]);

    expect(payment).not.toBeNull();
    expect((await allocated(sale.id)).toString()).toBe("600000");
    expect(sale.saleNo).toMatch(/^INV-\d{4}-\d{6}$/);
  });

  it("the same product can be sold in cartons and loose bottles on one invoice", async () => {
    const f = await fixture();
    const { sale } = await sell(f, {
      lines: [
        { productId: f.product.id, unitId: unitCarton, quantity: "1", unitPrice: "" },
        { productId: f.product.id, unitId: unitBottle, quantity: "3", unitPrice: "" },
      ],
    });
    expect(sale.total.toString()).toBe("375000"); // 300000 + 3 x 25000
    expect((await qty(f.product.id, f.location.id)).toString()).toBe("85"); // 100 - 12 - 3
  });

  it("wholesale customers get wholesale prices", async () => {
    const f = await fixture();
    const c = await newCustomer({ type: "WHOLESALE" });
    const { sale } = await sell(f, { customerId: c.id, lines: [{ productId: f.product.id, unitId: unitBottle, quantity: "10", unitPrice: "" }] });
    expect(sale.total.toString()).toBe("220000");
  });

  it("refuses discounts without permission, accepts them with it, and never allows a higher price", async () => {
    const f = await fixture();
    const line = (p: string) => [{ productId: f.product.id, unitId: unitBottle, quantity: "2", unitPrice: p }];
    await expect(sell(f, { lines: line("20000") })).rejects.toBeInstanceOf(SaleError);
    await expect(sell(f, { can: { discount: true, credit: true, approveCreditException: false }, lines: line("30000") })).rejects.toBeInstanceOf(SaleError);
    const allowed = { discount: true, credit: true, approveCreditException: false };
    // a discount without a reason is refused
    await expect(sell(f, { can: allowed, lines: line("20000") })).rejects.toBeInstanceOf(SaleError);
    const { sale } = await sell(f, { can: allowed, discountReason: "Regular customer", lines: line("20000") });
    expect(sale.discountReason).toBe("Regular customer");
    expect(sale.subtotal.toString()).toBe("50000");
    expect(sale.discountTotal.toString()).toBe("10000");
    expect(sale.total.toString()).toBe("40000");
  });
});

describe("credit sales", () => {
  it("records an unpaid invoice with a due date and raises the customer's balance", async () => {
    const f = await fixture();
    const c = await newCustomer({ creditLimit: 500000 });
    const { sale, payment } = await sell(f, { customerId: c.id, mode: "CREDIT", method: null, lines: [{ productId: f.product.id, unitId: unitBottle, quantity: "12", unitPrice: "" }] });
    expect(sale.paymentStatus).toBe("UNPAID");
    expect(sale.amountPaid.toString()).toBe("0");
    expect(sale.dueDate).not.toBeNull();
    expect(payment).toBeNull();
    expect((await customerOutstanding(db, c.id)).toString()).toBe("300000");
    expect((await qty(f.product.id, f.location.id)).toString()).toBe("88"); // stock still leaves
  });

  it("part payment leaves the rest outstanding", async () => {
    const f = await fixture();
    const c = await newCustomer({ creditLimit: 500000 });
    const { sale } = await sell(f, { customerId: c.id, mode: "PART", method: "MOBILE_MONEY", partAmount: "100000", reference: "MM123", lines: [{ productId: f.product.id, unitId: unitBottle, quantity: "12", unitPrice: "" }] });
    expect(sale.paymentStatus).toBe("PARTIALLY_PAID");
    expect(sale.amountPaid.toString()).toBe("100000");
    expect((await customerOutstanding(db, c.id)).toString()).toBe("200000");
    expect((await allocated(sale.id)).toString()).toBe("100000");
  });

  it("blocks a sale over the credit limit unless an authorised manager approves it", async () => {
    const f = await fixture();
    const c = await newCustomer({ creditLimit: 400000 });
    const line = [{ productId: f.product.id, unitId: unitBottle, quantity: "12", unitPrice: "" }]; // 300000
    await sell(f, { customerId: c.id, mode: "CREDIT", method: null, lines: line });
    await expect(sell(f, { customerId: c.id, mode: "CREDIT", method: null, lines: line })).rejects.toBeInstanceOf(CreditLimitError);
    // asking for an exception without the right permission still fails
    await expect(sell(f, { customerId: c.id, mode: "CREDIT", method: null, lines: line, creditException: { reason: "regular client" } })).rejects.toBeInstanceOf(CreditLimitError);
    // with permission it goes through and records who approved
    const { sale } = await sell(f, {
      user: { id: approverId },
      can: { discount: false, credit: true, approveCreditException: true },
      customerId: c.id,
      mode: "CREDIT",
      method: null,
      lines: line,
      creditException: { reason: "regular client, pays monthly" },
    });
    expect(sale.creditApprovedById).toBe(approverId);
    expect((await customerOutstanding(db, c.id)).toString()).toBe("600000");
  });

  it("a customer with no credit limit cannot buy on credit", async () => {
    const f = await fixture();
    const c = await newCustomer();
    await expect(sell(f, { customerId: c.id, mode: "CREDIT", method: null })).rejects.toBeInstanceOf(CreditLimitError);
  });

  it("walk-in customers cannot buy on credit; deactivated customers cannot buy at all; no permission, no credit", async () => {
    const f = await fixture();
    await expect(sell(f, { mode: "CREDIT", method: null })).rejects.toBeInstanceOf(SaleError);
    const off = await newCustomer({ status: "INACTIVE" });
    await expect(sell(f, { customerId: off.id })).rejects.toBeInstanceOf(SaleError);
    const ok = await newCustomer({ creditLimit: 1000000 });
    await expect(sell(f, { customerId: ok.id, mode: "CREDIT", method: null, can: { discount: false, credit: false, approveCreditException: false } })).rejects.toBeInstanceOf(SaleError);
  });
});

describe("integrity under pressure", () => {
  it("not enough stock: nothing is recorded at all", async () => {
    const f = await fixture(5);
    const before = await db.sale.count({ where: { locationId: f.location.id } });
    await expect(sell(f, { lines: [{ productId: f.product.id, unitId: unitBottle, quantity: "6", unitPrice: "" }] })).rejects.toBeInstanceOf(InsufficientStockError);
    expect(await db.sale.count({ where: { locationId: f.location.id } })).toBe(before);
    expect(await db.payment.count({ where: { receivedById: userId, amount: 150000 } })).toBe(0);
    expect((await qty(f.product.id, f.location.id)).toString()).toBe("5");
  });

  it("20 simultaneous sales of 1 bottle against 10 in stock: exactly 10 succeed, stock ends at 0", async () => {
    const f = await fixture(10);
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => sell(f)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
    expect(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason instanceof InsufficientStockError)).toBe(true);
    expect((await qty(f.product.id, f.location.id)).toString()).toBe("0");
    expect(await db.sale.count({ where: { locationId: f.location.id } })).toBe(10);
    // every sale is fully backed by an allocated payment
    const sales = await db.sale.findMany({ where: { locationId: f.location.id } });
    for (const s of sales) expect((await allocated(s.id)).eq(s.amountPaid)).toBe(true);
  });

  it("simultaneous credit sales cannot jointly exceed the credit limit", async () => {
    const f = await fixture(100);
    const c = await newCustomer({ creditLimit: 125000 }); // 5 bottles @ 25000
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => sell(f, { customerId: c.id, mode: "CREDIT", method: null })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    expect((await customerOutstanding(db, c.id)).toString()).toBe("125000");
  });

  it("a double-submitted form (same key) creates one sale and takes stock once", async () => {
    const f = await fixture(10);
    const key = randomUUID();
    const results = await Promise.allSettled([sell(f, { submissionKey: key }), sell(f, { submissionKey: key })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await qty(f.product.id, f.location.id)).toString()).toBe("9");
  });

  it("posted sales and payments are protected by the database", async () => {
    const f = await fixture();
    const { sale, payment } = await sell(f);
    await expect(db.sale.update({ where: { id: sale.id }, data: { total: 1 } })).rejects.toThrow(/cannot be edited/);
    await expect(db.sale.delete({ where: { id: sale.id } })).rejects.toThrow(/cannot be deleted/);
    await expect(db.payment.update({ where: { id: payment!.id }, data: { amount: 1 } })).rejects.toThrow(/posted document/);
    await expect(db.saleItem.deleteMany({ where: { saleId: sale.id } })).rejects.toThrow(/posted document/);
    // an invoice cannot be marked paid without the money
    const c = await newCustomer({ creditLimit: 1000000 });
    const unpaid = (await sell(f, { customerId: c.id, mode: "CREDIT", method: null })).sale;
    await expect(db.sale.update({ where: { id: unpaid.id }, data: { paymentStatus: "PAID" } })).rejects.toThrow();
    await expect(db.sale.update({ where: { id: unpaid.id }, data: { amountPaid: 1 } })).rejects.toThrow(); // status says UNPAID
  });
});

describe("carton-only products", () => {
  it("refuses single pieces when the product is sold by the carton only, and still sells cartons", async () => {
    const f = await fixture(100);
    await db.product.update({ where: { id: f.product.id }, data: { allowPieceSales: false } });
    await expect(sell(f, { lines: [{ productId: f.product.id, unitId: unitBottle, quantity: "5", unitPrice: "" }] })).rejects.toThrow(SaleError);
    expect((await qty(f.product.id, f.location.id)).toString()).toBe("100"); // nothing left the shelf
    await sell(f, { lines: [{ productId: f.product.id, unitId: unitCarton, quantity: "2", unitPrice: "" }] });
    expect((await qty(f.product.id, f.location.id)).toString()).toBe("76"); // 2 cartons = 24 pieces
  });

  it("single pieces and cartons can be sold together when pieces are allowed", async () => {
    const f = await fixture(100);
    await sell(f, { lines: [{ productId: f.product.id, unitId: unitCarton, quantity: "2", unitPrice: "" }, { productId: f.product.id, unitId: unitBottle, quantity: "5", unitPrice: "" }] });
    expect((await qty(f.product.id, f.location.id)).toString()).toBe("71"); // 24 + 5 pieces
  });
});
