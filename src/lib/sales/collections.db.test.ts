import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { postReceipt } from "@/lib/inventory/documents";
import { resolveLines } from "@/lib/inventory/lines";
import { CollectionError, customerCredit, postCollection, postCreditApplication } from "./collections";
import { customerOutstanding } from "./outstanding";
import { postSale, type SaleInput } from "./post-sale";
import { getStatement } from "./statement";

const D = (v: string | number) => new Prisma.Decimal(v);
let userId: string;
let unitBottle: string;
let categoryId: string;

beforeAll(async () => {
  const role = await db.role.create({ data: { key: `T_${randomUUID()}`, name: "Test role" } });
  userId = (await db.user.create({ data: { username: `t_${randomUUID()}`, name: "Cashier", passwordHash: "x", roleId: role.id } })).id;
  unitBottle = (await db.unit.create({ data: { name: `Bottle ${randomUUID()}`, symbol: randomUUID().slice(0, 8) } })).id;
  categoryId = (await db.category.create({ data: { name: `Cat ${randomUUID()}` } })).id;
});

async function world(limit = 10_000_000) {
  const location = await db.location.create({ data: { code: randomUUID().slice(0, 8).toUpperCase(), name: `Loc ${randomUUID()}` } });
  const product = await db.product.create({ data: { sku: `SKU-${randomUUID()}`, name: "Test oil", categoryId, baseUnitId: unitBottle, purchasePrice: 10000, sellingPrice: 25000 } });
  await db.$transaction(async (tx) => {
    const r = await resolveLines(tx, [{ productId: product.id, unitId: unitBottle, quantity: "1000" }]);
    if (!r.ok) throw new Error(r.message);
    await postReceipt(tx, { type: "OPENING_STOCK", supplierId: null, locationId: location.id, supplierInvoice: null, receivedDate: new Date(), notes: null, submissionKey: randomUUID(), lines: r.lines.map((l) => ({ ...l, lineTotal: D(10_000_000) })), user: { id: userId } });
  });
  const customer = await db.customer.create({ data: { name: `Cust ${randomUUID()}`, creditLimit: limit } });
  return { location, product, customer };
}
type W = Awaited<ReturnType<typeof world>>;

/** A credit sale of `bottles` bottles (25000 each) to the customer. */
function creditSale(w: W, bottles: number, over: Partial<SaleInput> = {}) {
  const input: SaleInput = {
    user: { id: userId },
    can: { discount: false, credit: true, approveCreditException: false },
    customerId: w.customer.id,
    locationId: w.location.id,
    mode: "CREDIT",
    method: null,
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

function collect(w: W, amount: number, allocations: { saleId: string; amount: number }[], over: { keepExtraAsCredit?: boolean; submissionKey?: string; customerId?: string } = {}) {
  return db.$transaction(
    (tx) =>
      postCollection(tx, {
        user: { id: userId },
        customerId: over.customerId ?? w.customer.id,
        method: "MOBILE_MONEY",
        amount: String(amount),
        reference: "MM1",
        notes: null,
        allocations: allocations.map((a) => ({ saleId: a.saleId, amount: String(a.amount) })),
        keepExtraAsCredit: over.keepExtraAsCredit ?? false,
        submissionKey: over.submissionKey ?? randomUUID(),
        currencyDecimals: 0,
      }),
    { timeout: 30000 },
  );
}

const reload = (id: string) => db.sale.findUniqueOrThrow({ where: { id } });

describe("collecting payments", () => {
  it("partial payments move an invoice UNPAID → PARTIALLY_PAID → PAID and reduce the balance each time", async () => {
    const w = await world();
    const sale = await creditSale(w, 12); // 300000
    await collect(w, 100000, [{ saleId: sale.id, amount: 100000 }]);
    let s = await reload(sale.id);
    expect([s.paymentStatus, s.amountPaid.toString()]).toEqual(["PARTIALLY_PAID", "100000"]);
    expect((await customerOutstanding(db, w.customer.id)).toString()).toBe("200000");

    await collect(w, 200000, [{ saleId: sale.id, amount: 200000 }]);
    s = await reload(sale.id);
    expect([s.paymentStatus, s.amountPaid.toString()]).toEqual(["PAID", "300000"]);
    expect((await customerOutstanding(db, w.customer.id)).toString()).toBe("0");
  });

  it("one payment can cover several invoices", async () => {
    const w = await world();
    const a = await creditSale(w, 4); // 100000
    const b = await creditSale(w, 8); // 200000
    const { payment } = await collect(w, 250000, [{ saleId: a.id, amount: 100000 }, { saleId: b.id, amount: 150000 }]);
    expect((await reload(a.id)).paymentStatus).toBe("PAID");
    expect((await reload(b.id)).paymentStatus).toBe("PARTIALLY_PAID");
    expect(payment.source).toBe("DEBT_COLLECTION");
    expect((await customerOutstanding(db, w.customer.id)).toString()).toBe("50000");
  });

  it("collecting money never creates a new sale", async () => {
    const w = await world();
    const sale = await creditSale(w, 4);
    const before = await db.sale.count({ where: { customerId: w.customer.id } });
    await collect(w, 100000, [{ saleId: sale.id, amount: 100000 }]);
    expect(await db.sale.count({ where: { customerId: w.customer.id } })).toBe(before);
    const totals = await db.sale.aggregate({ where: { customerId: w.customer.id }, _sum: { total: true } });
    expect(totals._sum.total!.toString()).toBe("100000"); // revenue is still just the one invoice
  });

  it("refuses a payment above what is owed unless the extra is explicitly kept as customer credit", async () => {
    const w = await world();
    const sale = await creditSale(w, 4); // 100000
    await expect(collect(w, 150000, [{ saleId: sale.id, amount: 100000 }])).rejects.toBeInstanceOf(CollectionError);
    expect((await reload(sale.id)).paymentStatus).toBe("UNPAID");

    await collect(w, 150000, [{ saleId: sale.id, amount: 100000 }], { keepExtraAsCredit: true });
    expect((await reload(sale.id)).paymentStatus).toBe("PAID");
    expect((await customerCredit(db, w.customer.id)).toString()).toBe("50000");
    expect((await customerOutstanding(db, w.customer.id)).toString()).toBe("0");
  });

  it("refuses an allocation above the invoice balance, to another customer's invoice, to a paid invoice, or twice", async () => {
    const w = await world();
    const other = await world();
    const sale = await creditSale(w, 4);
    const foreign = await creditSale(other, 4);
    await expect(collect(w, 100001, [{ saleId: sale.id, amount: 100001 }])).rejects.toBeInstanceOf(CollectionError);
    await expect(collect(w, 50000, [{ saleId: foreign.id, amount: 50000 }])).rejects.toBeInstanceOf(CollectionError);
    await expect(collect(w, 100000, [{ saleId: sale.id, amount: 50000 }, { saleId: sale.id, amount: 50000 }])).rejects.toBeInstanceOf(CollectionError);
    await collect(w, 100000, [{ saleId: sale.id, amount: 100000 }]);
    await expect(collect(w, 1, [{ saleId: sale.id, amount: 1 }])).rejects.toBeInstanceOf(CollectionError);
    expect((await reload(foreign.id)).amountPaid.toString()).toBe("0");
  });

  it("a double-submitted payment (same key) is recorded once", async () => {
    const w = await world();
    const sale = await creditSale(w, 4);
    const key = randomUUID();
    const results = await Promise.allSettled([collect(w, 40000, [{ saleId: sale.id, amount: 40000 }], { submissionKey: key }), collect(w, 40000, [{ saleId: sale.id, amount: 40000 }], { submissionKey: key })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await reload(sale.id)).amountPaid.toString()).toBe("40000");
  });
});

describe("customer credit (advance payments)", () => {
  it("advance credit can pay later invoices, oldest money first, and cannot be overspent", async () => {
    const w = await world();
    await collect(w, 60000, [], { keepExtraAsCredit: true }); // pure advance
    await collect(w, 40000, [], { keepExtraAsCredit: true });
    expect((await customerCredit(db, w.customer.id)).toString()).toBe("100000");

    const sale = await creditSale(w, 8); // 200000
    const apply = (amount: number, key = randomUUID()) =>
      db.$transaction((tx) => postCreditApplication(tx, { user: { id: userId }, customerId: w.customer.id, allocations: [{ saleId: sale.id, amount: String(amount) }], notes: null, submissionKey: key, currencyDecimals: 0 }));

    await expect(apply(100001)).rejects.toBeInstanceOf(CollectionError); // more than the credit
    const { application } = await apply(80000);
    expect(application.amount.toString()).toBe("80000");
    expect((await customerCredit(db, w.customer.id)).toString()).toBe("20000");
    const s = await reload(sale.id);
    expect([s.paymentStatus, s.amountPaid.toString()]).toEqual(["PARTIALLY_PAID", "80000"]);
    // 80000 drew from the 60000 payment first (all of it), then 20000 of the 40000 one
    const allocs = await db.paymentAllocation.findMany({ where: { saleId: sale.id }, include: { payment: true }, orderBy: { payment: { receivedAt: "asc" } } });
    expect(allocs.map((a) => a.amount.toString())).toEqual(["60000", "20000"]);
    expect(allocs.every((a) => a.creditApplicationId === application.id)).toBe(true);
  });
});

describe("integrity under pressure", () => {
  it("ten simultaneous 100 payments against a 500 invoice: exactly five succeed and the invoice is never over-paid", async () => {
    const w = await world();
    const sale = await creditSale(w, 1, { lines: [{ productId: w.product.id, unitId: unitBottle, quantity: "1", unitPrice: "" }] }); // 25000
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => collect(w, 5000, [{ saleId: sale.id, amount: 5000 }])));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    const s = await reload(sale.id);
    expect([s.paymentStatus, s.amountPaid.toString()]).toEqual(["PAID", "25000"]);
  });

  it("sales and collections for the same customer at the same time never deadlock and always reconcile", async () => {
    const w = await world();
    const first = await creditSale(w, 20); // 500000
    const jobs = [
      ...Array.from({ length: 6 }, () => collect(w, 10000, [{ saleId: first.id, amount: 10000 }])),
      ...Array.from({ length: 6 }, () => creditSale(w, 1)),
    ];
    const results = await Promise.allSettled(jobs);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    // outstanding = all invoices (500000 + 6 x 25000) - all collected (60000)
    expect((await customerOutstanding(db, w.customer.id)).toString()).toBe("590000");
    const sales = await db.sale.findMany({ where: { customerId: w.customer.id } });
    for (const s of sales) {
      const a = await db.paymentAllocation.aggregate({ where: { saleId: s.id }, _sum: { amount: true } });
      expect((a._sum.amount ?? D(0)).eq(s.amountPaid)).toBe(true);
    }
  });

  it("the database refuses over-allocating a payment, cross-customer allocation, and a sale whose paid amount has no payment behind it", async () => {
    const w = await world();
    const other = await world();
    const sale = await creditSale(w, 4);
    const foreign = await creditSale(other, 4);
    const { payment } = await collect(w, 10000, [{ saleId: sale.id, amount: 10000 }]);

    await expect(db.paymentAllocation.create({ data: { paymentId: payment.id, saleId: sale.id, amount: 1 } })).rejects.toThrow(/exceed the payment amount/);
    await expect(db.paymentAllocation.create({ data: { paymentId: payment.id, saleId: foreign.id, amount: 1 } })).rejects.toThrow(/same customer/);
    // marking money as received without a payment is caught at commit
    await expect(db.sale.update({ where: { id: sale.id }, data: { amountPaid: 90000, paymentStatus: "PARTIALLY_PAID" } })).rejects.toThrow(/inconsistent/);
    expect((await reload(sale.id)).amountPaid.toString()).toBe("10000");
  });
});

describe("customer statement", () => {
  it("lists invoices and payments in order and ends on exactly what the customer owes", async () => {
    const w = await world();
    const a = await creditSale(w, 20); // 500000
    await collect(w, 200000, [{ saleId: a.id, amount: 200000 }]);
    const b = await creditSale(w, 12); // 300000
    await collect(w, 50000, [], { keepExtraAsCredit: true }); // advance
    void b;

    const st = await getStatement(db, w.customer.id);
    expect(st.opening.toString()).toBe("0");
    expect(st.lines.map((l) => l.kind)).toEqual(["INVOICE", "PAYMENT", "INVOICE", "PAYMENT"]);
    expect(st.lines.map((l) => l.balance.toString())).toEqual(["500000", "300000", "600000", "550000"]);
    // statement balance = what is owed on invoices (600000... 300000 + 300000) minus advance credit (50000)
    const owed = await customerOutstanding(db, w.customer.id);
    const credit = await customerCredit(db, w.customer.id);
    expect(owed.minus(credit).toString()).toBe(st.closing.toString());
  });

  it("a date range starts from the correct opening balance", async () => {
    const w = await world();
    const a = await creditSale(w, 4); // 100000
    await collect(w, 40000, [{ saleId: a.id, amount: 40000 }]);
    const cutoff = new Date(Date.now() + 1000);
    await new Promise((r) => setTimeout(r, 1200));
    await creditSale(w, 4); // 100000, after the cutoff
    const st = await getStatement(db, w.customer.id, cutoff);
    expect(st.opening.toString()).toBe("60000");
    expect(st.lines).toHaveLength(1);
    expect(st.closing.toString()).toBe("160000");
  });
});
