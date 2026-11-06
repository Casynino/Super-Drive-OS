import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { postReceipt } from "@/lib/inventory/documents";
import { resolveLines } from "@/lib/inventory/lines";
import { postCollection } from "@/lib/sales/collections";
import { postSale, type SaleInput } from "@/lib/sales/post-sale";
import { completeReversal, createReversalRequest } from "@/lib/sales/reversals";
import { postDeposit, postManualCash } from "./deposits";
import { recordExpense, reverseExpense } from "./expenses";
import { accountBalance, businessDay, getAccountBalances, listAccounts } from "./ledger";
import { getMoneySummary, getTillToday } from "./summary";

const D = (v: string | number) => new Prisma.Decimal(v);
let userId: string;
let unit: string;
let categoryId: string;
let expenseCategoryId: string;

beforeAll(async () => {
  const role = await db.role.create({ data: { key: `T_${randomUUID()}`, name: "Test role" } });
  userId = (await db.user.create({ data: { username: `t_${randomUUID()}`, name: "Cashier", passwordHash: "x", roleId: role.id } })).id;
  unit = (await db.unit.create({ data: { name: `Bottle ${randomUUID()}`, symbol: randomUUID().slice(0, 8) } })).id;
  categoryId = (await db.category.create({ data: { name: `Cat ${randomUUID()}` } })).id;
  expenseCategoryId = (await db.expenseCategory.create({ data: { name: `Exp ${randomUUID()}` } })).id;
});

/** A shop with stock, a customer, the till, M-PESA (the only mobile account) and two banks: CRDB (the main one) and NMB. */
async function shop() {
  const location = await db.location.create({ data: { code: randomUUID().slice(0, 8).toUpperCase(), name: `Loc ${randomUUID()}` } });
  const product = await db.product.create({ data: { sku: `SKU-${randomUUID()}`, name: "Test oil", categoryId, baseUnitId: unit, purchasePrice: 10000, sellingPrice: 25000 } });
  await db.$transaction(async (tx) => {
    const r = await resolveLines(tx, [{ productId: product.id, unitId: unit, quantity: "100" }]);
    if (!r.ok) throw new Error(r.message);
    await postReceipt(tx, { type: "OPENING_STOCK", supplierId: null, locationId: location.id, supplierInvoice: null, receivedDate: new Date(), notes: null, submissionKey: randomUUID(), lines: r.lines.map((l) => ({ ...l, lineTotal: D(1_000_000) })), user: { id: userId } });
  });
  const customer = await db.customer.create({ data: { name: `Cust ${randomUUID()}`, phone: "0712 000 111", creditLimit: 10_000_000 } });
  const mk = (method: "CASH" | "MOBILE_MONEY" | "BANK", name: string, accountNumber: string | null, isDefault: boolean) => db.cashAccount.create({ data: { locationId: location.id, method, name, accountNumber, holderName: "ABEL JACOB KIJYOMBO", isDefault } });
  const [till, mpesa, crdb, nmb] = await Promise.all([mk("CASH", "Cash", null, true), mk("MOBILE_MONEY", "M-PESA", "37453908", true), mk("BANK", "CRDB Bank", "0152841983800", true), mk("BANK", "NMB Bank", "20410052450", false)]);
  return { location, product, customer, till, mpesa, crdb, nmb };
}
type S = Awaited<ReturnType<typeof shop>>;

function sell(s: S, bottles: number, over: Partial<SaleInput> = {}) {
  const input: SaleInput = {
    user: { id: userId },
    can: { discount: false, credit: true, approveCreditException: false },
    customerId: s.customer.id,
    locationId: s.location.id,
    mode: "FULL",
    method: "CASH",
    partAmount: null,
    reference: null,
    notes: null,
    lines: [{ productId: s.product.id, unitId: unit, quantity: String(bottles), unitPrice: "" }],
    creditException: null,
    submissionKey: randomUUID(),
    currencyDecimals: 0,
    creditTermsDays: 30,
    ...over,
  };
  return db.$transaction((tx) => postSale(tx, input), { timeout: 30000 }).then((r) => r.sale);
}
const bal = (id: string) => accountBalance(db, id).then((v) => v.toString());

describe("a sale is paid into the account the cashier chooses", () => {
  it("money paid by bank into CRDB lands in CRDB, and nowhere else", async () => {
    const s = await shop();
    const sale = await sell(s, 4, { method: "BANK", accountId: s.crdb.id }); // 100,000
    expect(await bal(s.crdb.id)).toBe("100000");
    expect(await bal(s.nmb.id)).toBe("0");
    expect(await bal(s.till.id)).toBe("0");
    const row = await db.cashTransaction.findFirstOrThrow({ where: { accountId: s.crdb.id } });
    expect([row.type, row.referenceType]).toEqual(["SALE_PAYMENT", "Payment"]);
    expect(sale.paymentStatus).toBe("PAID");
  });

  it("the other bank gets its own sales, and each account's balance is its own", async () => {
    const s = await shop();
    await sell(s, 2, { method: "BANK", accountId: s.crdb.id }); // 50,000
    await sell(s, 1, { method: "BANK", accountId: s.nmb.id }); // 25,000
    await sell(s, 3, { method: "CASH" }); // 75,000 into the till (the only cash account)
    await sell(s, 4, { method: "MOBILE_MONEY" }); // 100,000 into M-PESA (the only mobile account, so no choice is needed)
    expect([await bal(s.crdb.id), await bal(s.nmb.id), await bal(s.till.id), await bal(s.mpesa.id)]).toEqual(["50000", "25000", "75000", "100000"]);
    const list = await getAccountBalances(db, s.location.id);
    expect(list.map((a) => [a.name, a.balance.toString()])).toEqual([["Cash", "75000"], ["M-PESA", "100000"], ["CRDB Bank", "50000"], ["NMB Bank", "25000"]]);
  });

  it("with two open bank accounts the cashier must say which: nothing is sold or recorded without it", async () => {
    const s = await shop();
    await expect(sell(s, 2, { method: "BANK" })).rejects.toThrow(/Choose which account/i);
    expect(await db.sale.count({ where: { locationId: s.location.id } })).toBe(0);
    expect((await db.stockBalance.findFirstOrThrow({ where: { productId: s.product.id, locationId: s.location.id } })).quantity.toString()).toBe("100");
    expect(await bal(s.crdb.id)).toBe("0");
  });

  it("refuses an account of another payment method, from another shop, or a closed one", async () => {
    const s = await shop();
    const other = await shop();
    await expect(sell(s, 1, { method: "CASH", accountId: s.crdb.id })).rejects.toThrow(/not a cash/i);
    await expect(sell(s, 1, { method: "BANK", accountId: other.crdb.id })).rejects.toThrow(/does not exist here/i);
    await db.cashAccount.update({ where: { id: s.nmb.id }, data: { status: "INACTIVE" } });
    await expect(sell(s, 1, { method: "BANK", accountId: s.nmb.id })).rejects.toThrow(/closed/i);
    // and once NMB is closed, CRDB is the only open bank account, so no choice is needed any more
    await sell(s, 1, { method: "BANK" });
    expect(await bal(s.crdb.id)).toBe("25000");
  });
});

describe("money in later, money out, and transfers keep to their account", () => {
  it("a debt collected by bank goes into the bank account chosen", async () => {
    const s = await shop();
    const sale = await sell(s, 4, { mode: "CREDIT", method: null }); // 100,000 owed
    await db.$transaction((tx) =>
      postCollection(tx, { user: { id: userId }, customerId: s.customer.id, method: "BANK", accountId: s.nmb.id, amount: "60000", reference: "REF1", notes: null, allocations: [{ saleId: sale.id, amount: "60000" }], keepExtraAsCredit: false, submissionKey: randomUUID(), currencyDecimals: 0 }),
    );
    expect([await bal(s.nmb.id), await bal(s.crdb.id)]).toEqual(["60000", "0"]);
    const row = await db.cashTransaction.findFirstOrThrow({ where: { accountId: s.nmb.id } });
    expect(row.type).toBe("COLLECTION");
  });

  it("a refund goes back out of the account the customer paid into", async () => {
    const s = await shop();
    const sale = await sell(s, 4, { method: "BANK", accountId: s.nmb.id }); // 100,000 into NMB
    const items = await db.saleItem.findMany({ where: { saleId: sale.id } });
    const req = await db.$transaction((tx) => createReversalRequest(tx, { user: { id: userId }, saleId: sale.id, kind: "RETURN", reason: "Customer changed his mind", refundMethod: "BANK", refundReference: "REF-R1", lines: [{ saleItemId: items[0]!.id, quantity: "1", condition: "RESELLABLE" }], submissionKey: randomUUID() }));
    await db.$transaction((tx) => completeReversal(tx, { reversalId: req.id, approver: { id: userId }, dp: 0 }), { timeout: 30000 });
    expect([await bal(s.nmb.id), await bal(s.crdb.id)]).toEqual(["75000", "0"]); // 100,000 in, 25,000 back out of NMB (not CRDB)
  });

  it("an expense leaves the account chosen, cannot overspend it, and its reversal goes back there", async () => {
    const s = await shop();
    await db.$transaction((tx) => postManualCash(tx, { user: { id: userId }, locationId: s.location.id, method: "BANK", accountId: s.crdb.id, kind: "OPENING", amount: "50000", reason: "", submissionKey: randomUUID(), currencyDecimals: 0 }));
    const spend = (amount: string, accountId: string) =>
      db.$transaction((tx) => recordExpense(tx, { user: { id: userId }, categoryId: expenseCategoryId, description: "Transport to Mwenge", amount, method: "BANK", accountId, expenseDate: "", notes: null, receiptId: null, submissionKey: randomUUID(), currencyDecimals: 0, approvalLimit: D(0), canApprove: true, locationId: s.location.id }));
    const first = await spend("30000", s.crdb.id);
    expect(await bal(s.crdb.id)).toBe("20000");
    await expect(spend("30000", s.crdb.id)).rejects.toThrow(/only 20,000 in CRDB Bank/);
    await expect(spend("1000", s.nmb.id)).rejects.toThrow(/only 0 in NMB Bank/); // NMB holds nothing, whatever CRDB holds
    await db.$transaction((tx) => reverseExpense(tx, { expenseId: first.expense.id, by: { id: userId }, reason: "Wrong amount" }));
    expect([await bal(s.crdb.id), await bal(s.nmb.id)]).toEqual(["50000", "0"]);
  });

  it("a deposit puts the cash into the bank account chosen; with two open banks it must be named", async () => {
    const s = await shop();
    await db.$transaction((tx) => postManualCash(tx, { user: { id: userId }, locationId: s.location.id, method: "CASH", kind: "OPENING", amount: "100000", reason: "", submissionKey: randomUUID(), currencyDecimals: 0 }));
    const deposit = (bankAccountId?: string) => db.$transaction((tx) => postDeposit(tx, { user: { id: userId }, locationId: s.location.id, amount: "40000", bankReference: "SLIP-1", notes: null, slipId: null, bankAccountId, submissionKey: randomUUID(), currencyDecimals: 0 }));
    await expect(deposit()).rejects.toThrow(/Choose which account/i);
    await deposit(s.nmb.id);
    expect([await bal(s.till.id), await bal(s.nmb.id), await bal(s.crdb.id)]).toEqual(["60000", "40000", "0"]);
  });
});

describe("the database keeps the account rules", () => {
  it("allows one till per location and one main account per method", async () => {
    const s = await shop();
    await expect(db.cashAccount.create({ data: { locationId: s.location.id, method: "CASH", name: "Second till" } })).rejects.toThrow();
    await expect(db.cashAccount.create({ data: { locationId: s.location.id, method: "BANK", name: "Another main bank", isDefault: true } })).rejects.toThrow();
    await db.cashAccount.create({ data: { locationId: s.location.id, method: "BANK", name: "Equity Bank" } }); // not the main one: fine
    expect((await listAccounts(db, s.location.id)).filter((a) => a.method === "BANK")).toHaveLength(3);
  });
});

describe("expenses need no approval unless the owner sets a limit", () => {
  const spend = (s: S, amount: string, over: { approvalLimit?: Prisma.Decimal; canApprove?: boolean } = {}) =>
    db.$transaction((tx) => recordExpense(tx, { user: { id: userId }, categoryId: expenseCategoryId, description: "Packing tape", amount, method: "CASH", accountId: s.till.id, expenseDate: "", notes: null, receiptId: null, submissionKey: randomUUID(), currencyDecimals: 0, approvalLimit: over.approvalLimit ?? D(0), canApprove: over.canApprove ?? false, locationId: s.location.id }));

  it("with no limit (0) an expense recorded by staff is paid at once", async () => {
    const s = await shop();
    await db.$transaction((tx) => postManualCash(tx, { user: { id: userId }, locationId: s.location.id, method: "CASH", kind: "OPENING", amount: "100000", reason: "", submissionKey: randomUUID(), currencyDecimals: 0 }));
    const r = await spend(s, "30000");
    expect([r.approvedNow, r.expense.status]).toEqual([true, "APPROVED"]);
    expect(await bal(s.till.id)).toBe("70000");
  });

  it("with a limit set, only the amount above it waits and nothing moves until it is approved", async () => {
    const s = await shop();
    await db.$transaction((tx) => postManualCash(tx, { user: { id: userId }, locationId: s.location.id, method: "CASH", kind: "OPENING", amount: "100000", reason: "", submissionKey: randomUUID(), currencyDecimals: 0 }));
    expect((await spend(s, "5000", { approvalLimit: D(10000) })).approvedNow).toBe(true);
    const big = await spend(s, "30000", { approvalLimit: D(10000) });
    expect([big.approvedNow, big.expense.status]).toEqual([false, "PENDING"]);
    expect(await bal(s.till.id)).toBe("95000"); // only the small one left the till
  });
});

describe("the shop's cash for the day and the owner's summary come from the same ledger", () => {
  it("cash received, used, taken to the bank and still at the shop add up, and the owner's numbers agree", async () => {
    const s = await shop();
    await sell(s, 4, { method: "CASH" }); // 100,000 received in cash
    await db.$transaction((tx) => recordExpense(tx, { user: { id: userId }, categoryId: expenseCategoryId, description: "Fuel", amount: "30000", method: "CASH", accountId: s.till.id, expenseDate: "", notes: null, receiptId: null, submissionKey: randomUUID(), currencyDecimals: 0, approvalLimit: D(0), canApprove: false, locationId: s.location.id }));
    await db.$transaction((tx) => postDeposit(tx, { user: { id: userId }, locationId: s.location.id, amount: "40000", bankReference: "SLIP-9", notes: null, slipId: null, bankAccountId: s.nmb.id, submissionKey: randomUUID(), currencyDecimals: 0 }));

    const till = await getTillToday(db, s.location.id, businessDay());
    expect([till.received, till.expenses, till.deposited, till.balance].map((v) => v.toString())).toEqual(["100000", "30000", "40000", "30000"]); // 100,000 − 30,000 − 40,000 still at the shop

    const m = await getMoneySummary(db, s.location.id, { from: businessDay(), to: businessDay() });
    expect([m.income, m.expenses, m.left, m.moved].map((v) => v.toString())).toEqual(["100000", "30000", "70000", "40000"]); // the deposit only moved money: it is not spending
    expect(m.byAccount.find((a) => a.id === s.till.id)?.income.toString()).toBe("100000");
  });
});
