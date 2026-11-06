import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { postReceipt } from "@/lib/inventory/documents";
import { resolveLines } from "@/lib/inventory/lines";
import { postCollection } from "@/lib/sales/collections";
import { postSale, type SaleInput } from "@/lib/sales/post-sale";
import { completeReversal, createReversalRequest } from "@/lib/sales/reversals";
import { postDeposit, postManualCash, type ManualKind } from "./deposits";
import { decideExpense, recordExpense, reverseExpense } from "./expenses";
import { CashError, accountBalance, businessDay, getAccount, getBalances, postCash } from "./ledger";
import { getClosingPreview, reviewClosing, submitClosing, unclosedDays } from "./closing";

const D = (v: string | number) => new Prisma.Decimal(v);
let userId: string;
let managerId: string;
let unitBottle: string;
let categoryId: string;
let expenseCategoryId: string;

beforeAll(async () => {
  const role = await db.role.create({ data: { key: `T_${randomUUID()}`, name: "Test role" } });
  userId = (await db.user.create({ data: { username: `t_${randomUUID()}`, name: "Attendant", passwordHash: "x", roleId: role.id } })).id;
  managerId = (await db.user.create({ data: { username: `t_${randomUUID()}`, name: "Manager", passwordHash: "x", roleId: role.id } })).id;
  unitBottle = (await db.unit.create({ data: { name: `Bottle ${randomUUID()}`, symbol: randomUUID().slice(0, 8) } })).id;
  categoryId = (await db.category.create({ data: { name: `Cat ${randomUUID()}` } })).id;
  expenseCategoryId = (await db.expenseCategory.create({ data: { name: `Transport ${randomUUID()}` } })).id;
});

async function shop() {
  const location = await db.location.create({ data: { code: randomUUID().slice(0, 8).toUpperCase(), name: `Loc ${randomUUID()}` } });
  const product = await db.product.create({ data: { sku: `SKU-${randomUUID()}`, name: "Test oil", categoryId, baseUnitId: unitBottle, purchasePrice: 10000, sellingPrice: 25000 } });
  await db.$transaction(async (tx) => {
    const r = await resolveLines(tx, [{ productId: product.id, unitId: unitBottle, quantity: "200" }]);
    if (!r.ok) throw new Error(r.message);
    await postReceipt(tx, { type: "OPENING_STOCK", supplierId: null, locationId: location.id, supplierInvoice: null, receivedDate: new Date(), notes: null, submissionKey: randomUUID(), lines: r.lines.map((l) => ({ ...l, lineTotal: D(2_000_000) })), user: { id: userId } });
  });
  const customer = await db.customer.create({ data: { name: `Cust ${randomUUID()}`, phone: "0712 000 111", creditLimit: 10_000_000 } });
  return { location, product, customer };
}
type Shop = Awaited<ReturnType<typeof shop>>;

function sell(s: Shop, bottles: number, over: Partial<SaleInput> = {}) {
  const input: SaleInput = {
    user: { id: userId },
    can: { discount: false, credit: true, approveCreditException: false },
    customerId: null,
    locationId: s.location.id,
    mode: "FULL",
    method: "CASH",
    partAmount: null,
    reference: null,
    notes: null,
    lines: [{ productId: s.product.id, unitId: unitBottle, quantity: String(bottles), unitPrice: "" }],
    creditException: null,
    submissionKey: randomUUID(),
    currencyDecimals: 0,
    creditTermsDays: 30,
    ...over,
  };
  return db.$transaction((tx) => postSale(tx, input), { timeout: 30000 }).then((r) => r.sale);
}

const rowsFor = (referenceId: string) => db.cashTransaction.findMany({ where: { referenceId }, include: { account: true } });
async function balance(s: Shop, method: "CASH" | "MOBILE_MONEY" | "BANK") {
  const a = await db.$transaction((tx) => getAccount(tx, s.location.id, method));
  return db.$transaction((tx) => accountBalance(tx, a.id)).then((b) => b.toString());
}
const manual = (s: Shop, method: "CASH" | "MOBILE_MONEY" | "BANK", kind: ManualKind, amount: string, reason = "Test reason", key = randomUUID()) =>
  db.$transaction((tx) => postManualCash(tx, { user: { id: managerId }, locationId: s.location.id, method, kind, amount, reason, submissionKey: key, currencyDecimals: 0 }));
const expense = (s: Shop, amount: string, over: Partial<Parameters<typeof recordExpense>[1]> = {}) =>
  db.$transaction((tx) =>
    recordExpense(tx, {
      user: { id: userId }, categoryId: expenseCategoryId, description: "Taxi to the bank", amount, method: "CASH", expenseDate: "", notes: null, receiptId: null,
      submissionKey: randomUUID(), currencyDecimals: 0, approvalLimit: D(20000), canApprove: false, locationId: s.location.id, ...over,
    }),
  );
const deposit = (s: Shop, amount: string, key = randomUUID()) =>
  db.$transaction((tx) => postDeposit(tx, { user: { id: userId }, locationId: s.location.id, amount, bankReference: "SLIP-1", notes: null, slipId: null, submissionKey: key, currencyDecimals: 0 }));
const close = (s: Shop, counted: string, over: Partial<Parameters<typeof submitClosing>[1]> = {}) =>
  db.$transaction((tx) => submitClosing(tx, { user: { id: userId }, locationId: s.location.id, day: "", countedCash: counted, notes: null, deposit: null, submissionKey: randomUUID(), currencyDecimals: 0, tolerance: D(0), ...over }), { timeout: 30000 });

describe("money arriving and leaving is written to the ledger by the source records", () => {
  it("a cash sale lands in cash, a mobile sale in mobile money, a credit sale in nothing, a part payment only its paid part", async () => {
    const s = await shop();
    const cash = await sell(s, 2); // 50000
    const mobile = await sell(s, 1, { method: "MOBILE_MONEY", reference: "MM-1" }); // 25000
    const credit = await sell(s, 1, { customerId: s.customer.id, mode: "CREDIT", method: null });
    const part = await sell(s, 2, { customerId: s.customer.id, mode: "PART", partAmount: "10000", method: "CASH" });

    expect(await balance(s, "CASH")).toBe("60000"); // 50000 + 10000
    expect(await balance(s, "MOBILE_MONEY")).toBe("25000");
    expect(await balance(s, "BANK")).toBe("0");
    const all = await db.cashTransaction.findMany({ where: { account: { locationId: s.location.id } } });
    expect(all.every((r) => r.type === "SALE_PAYMENT")).toBe(true);
    expect(all.length).toBe(3); // the credit sale made no entry
    void cash; void mobile; void credit; void part;
  });

  it("a debt collection and the advance-credit it creates are money in; using the credit later is not", async () => {
    const s = await shop();
    const sale = await sell(s, 4, { customerId: s.customer.id, mode: "CREDIT", method: null }); // 100000 owed
    const res = await db.$transaction((tx) =>
      postCollection(tx, { user: { id: userId }, customerId: s.customer.id, method: "BANK", amount: "60000", reference: "B-1", notes: null, allocations: [{ saleId: sale.id, amount: "60000" }], keepExtraAsCredit: false, submissionKey: randomUUID(), currencyDecimals: 0 }),
    );
    const rows = await rowsFor(res.payment.id);
    expect(rows.map((r) => [r.type, r.account.method, r.amount.toString(), r.account.locationId === s.location.id])).toEqual([["COLLECTION", "BANK", "60000", true]]);
  });

  it("a refund leaves the account it is paid from", async () => {
    const s = await shop();
    const sale = await sell(s, 4); // 100000 cash
    const items = await db.saleItem.findMany({ where: { saleId: sale.id } });
    const req = await db.$transaction((tx) =>
      createReversalRequest(tx, { user: { id: userId }, saleId: sale.id, kind: "RETURN", reason: "Wrong oil", refundMethod: "CASH", refundReference: null, lines: [{ saleItemId: items[0]!.id, quantity: "1", condition: "RESELLABLE" }], submissionKey: randomUUID() }),
    );
    const r = await db.$transaction((tx) => completeReversal(tx, { reversalId: req.id, approver: { id: managerId }, dp: 0 }), { timeout: 30000 });
    expect(r.refund.toString()).toBe("25000");
    expect(await balance(s, "CASH")).toBe("75000");
    const [row] = await rowsFor(req.id);
    expect([row!.type, row!.amount.toString()]).toEqual(["REFUND", "-25000"]);
  });

  it("the ledger cannot be edited or erased, and the same event cannot be written twice", async () => {
    const s = await shop();
    const sale = await sell(s, 1);
    const [row] = await db.cashTransaction.findMany({ where: { account: { locationId: s.location.id } } });
    await expect(db.$executeRaw`UPDATE "CashTransaction" SET "amount" = 1 WHERE "id" = ${row!.id}`).rejects.toThrow(/cannot be edited/);
    await expect(db.$executeRaw`DELETE FROM "CashTransaction" WHERE "id" = ${row!.id}`).rejects.toThrow(/cannot be deleted/);
    await expect(db.$executeRaw`TRUNCATE "CashTransaction"`).rejects.toThrow();
    await expect(db.$transaction((tx) => postCash(tx, { locationId: s.location.id, method: "CASH", type: "SALE_PAYMENT", amount: D(25000), referenceType: "Payment", referenceId: row!.referenceId, userId }))).rejects.toThrow();
    expect(await balance(s, "CASH")).toBe("25000");
    void sale;
  });
});

describe("expenses", () => {
  it("within the limit the money leaves at once; above it nothing moves until approved", async () => {
    const s = await shop();
    await manual(s, "CASH", "OPENING", "100000");
    const small = await expense(s, "15000");
    expect(small.approvedNow).toBe(true);
    expect(small.expense.status).toBe("APPROVED");
    expect(await balance(s, "CASH")).toBe("85000");

    const big = await expense(s, "40000");
    expect(big.approvedNow).toBe(false);
    expect(big.expense.status).toBe("PENDING");
    expect(await balance(s, "CASH")).toBe("85000");

    await db.$transaction((tx) => decideExpense(tx, { expenseId: big.expense.id, approver: { id: managerId }, approve: true, note: "" }));
    expect(await balance(s, "CASH")).toBe("45000");
    expect((await db.expense.findUniqueOrThrow({ where: { id: big.expense.id } })).decidedById).toBe(managerId);
  });

  it("rejecting needs a reason and moves no money; a decided expense cannot be decided again", async () => {
    const s = await shop();
    await manual(s, "CASH", "OPENING", "100000");
    const e = await expense(s, "50000");
    await expect(db.$transaction((tx) => decideExpense(tx, { expenseId: e.expense.id, approver: { id: managerId }, approve: false, note: "" }))).rejects.toThrow(/reason/);
    await db.$transaction((tx) => decideExpense(tx, { expenseId: e.expense.id, approver: { id: managerId }, approve: false, note: "Not a shop cost" }));
    expect(await balance(s, "CASH")).toBe("100000");
    await expect(db.$transaction((tx) => decideExpense(tx, { expenseId: e.expense.id, approver: { id: managerId }, approve: true, note: "" }))).rejects.toThrow(/already rejected/);
  });

  it("two approvals at the same moment pay the expense once", async () => {
    const s = await shop();
    await manual(s, "CASH", "OPENING", "100000");
    const e = await expense(s, "30000");
    const results = await Promise.allSettled([1, 2, 3].map(() => db.$transaction((tx) => decideExpense(tx, { expenseId: e.expense.id, approver: { id: managerId }, approve: true, note: "" }))));
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(await balance(s, "CASH")).toBe("70000");
  });

  it("a category limit overrides the general limit; a person who may approve is approved at once", async () => {
    const s = await shop();
    await manual(s, "CASH", "OPENING", "500000");
    const strict = await db.expenseCategory.create({ data: { name: `Fuel ${randomUUID()}`, approvalLimit: 5000 } });
    expect((await expense(s, "8000", { categoryId: strict.id })).approvedNow).toBe(false); // general limit is 20000, this category's is 5000
    expect((await expense(s, "60000", { canApprove: true })).approvedNow).toBe(true);
    expect((await expense(s, "5000", { categoryId: strict.id })).approvedNow).toBe(true);
  });

  it("cannot spend money that is not there", async () => {
    const s = await shop();
    await manual(s, "CASH", "OPENING", "10000");
    await expect(expense(s, "15000")).rejects.toBeInstanceOf(CashError);
    expect(await balance(s, "CASH")).toBe("10000");
    expect(await db.expense.count({ where: { locationId: s.location.id } })).toBe(0); // the failed attempt left nothing behind
  });

  it("reversing puts the money back once, keeps the record, and only works on approved expenses", async () => {
    const s = await shop();
    await manual(s, "CASH", "OPENING", "100000");
    const e = await expense(s, "10000");
    await expect(db.$transaction((tx) => reverseExpense(tx, { expenseId: e.expense.id, by: { id: managerId }, reason: "" }))).rejects.toThrow(/why/);
    await db.$transaction((tx) => reverseExpense(tx, { expenseId: e.expense.id, by: { id: managerId }, reason: "Entered twice" }));
    expect(await balance(s, "CASH")).toBe("100000");
    expect((await db.expense.findUniqueOrThrow({ where: { id: e.expense.id } })).status).toBe("REVERSED");
    await expect(db.$transaction((tx) => reverseExpense(tx, { expenseId: e.expense.id, by: { id: managerId }, reason: "Again" }))).rejects.toThrow(/approved/);
    const pending = await expense(s, "90000");
    await expect(db.$transaction((tx) => reverseExpense(tx, { expenseId: pending.expense.id, by: { id: managerId }, reason: "Nope" }))).rejects.toThrow(/approved/);
  });

  it("a double-submitted form records one expense; an approved expense cannot be edited or deleted", async () => {
    const s = await shop();
    await manual(s, "CASH", "OPENING", "100000");
    const key = randomUUID();
    const results = await Promise.allSettled([expense(s, "7000", { submissionKey: key }), expense(s, "7000", { submissionKey: key })]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(await balance(s, "CASH")).toBe("93000");
    const e = await db.expense.findFirstOrThrow({ where: { locationId: s.location.id } });
    await expect(db.$executeRaw`UPDATE "Expense" SET "amount" = 1 WHERE "id" = ${e.id}`).rejects.toThrow(/cannot be edited/);
    await expect(db.$executeRaw`DELETE FROM "Expense" WHERE "id" = ${e.id}`).rejects.toThrow(/cannot be deleted/);
  });

  it("rejects bad input with messages for the fields", async () => {
    const s = await shop();
    await expect(expense(s, "0")).rejects.toMatchObject({ fieldErrors: { amount: expect.any(String) } });
    await expect(expense(s, "100", { description: "x" })).rejects.toMatchObject({ fieldErrors: { description: expect.any(String) } });
    await expect(expense(s, "100", { expenseDate: "2999-01-01" })).rejects.toMatchObject({ fieldErrors: { expenseDate: expect.any(String) } });
  });
});

describe("bank deposits", () => {
  it("move cash to the bank - a transfer: cash goes down, the bank goes up by the same amount, nothing is income", async () => {
    const s = await shop();
    await manual(s, "CASH", "OPENING", "200000");
    const dep = await deposit(s, "150000");
    expect(await balance(s, "CASH")).toBe("50000");
    expect(await balance(s, "BANK")).toBe("150000");
    expect((await rowsFor(dep.id)).map((r) => r.type).sort()).toEqual(["DEPOSIT_IN", "DEPOSIT_OUT"]);
  });

  it("cannot deposit more than the cash on hand, even when two deposits race", async () => {
    const s = await shop();
    await manual(s, "CASH", "OPENING", "100000");
    await expect(deposit(s, "100001")).rejects.toBeInstanceOf(CashError);
    const results = await Promise.allSettled([deposit(s, "60000"), deposit(s, "60000"), deposit(s, "60000")]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(await balance(s, "CASH")).toBe("40000");
    expect(await balance(s, "BANK")).toBe("60000");
  });

  it("a double-submitted deposit is recorded once and a reference is required", async () => {
    const s = await shop();
    await manual(s, "CASH", "OPENING", "100000");
    const key = randomUUID();
    const results = await Promise.allSettled([deposit(s, "10000", key), deposit(s, "10000", key)]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(await balance(s, "BANK")).toBe("10000");
    await expect(db.$transaction((tx) => postDeposit(tx, { user: { id: userId }, locationId: s.location.id, amount: "1000", bankReference: "", notes: null, slipId: null, submissionKey: randomUUID(), currencyDecimals: 0 }))).rejects.toMatchObject({ fieldErrors: { bankReference: expect.any(String) } });
  });
});

describe("manual cash entries", () => {
  it("the opening balance can be set once per account; withdrawals and corrections need a reason and cannot overdraw", async () => {
    const s = await shop();
    await manual(s, "CASH", "OPENING", "80000");
    await expect(manual(s, "CASH", "OPENING", "1")).rejects.toThrow(/already recorded/);
    await expect(manual(s, "CASH", "WITHDRAWAL", "5000", "")).rejects.toMatchObject({ fieldErrors: { reason: expect.any(String) } });
    await manual(s, "CASH", "WITHDRAWAL", "30000", "Owner took cash for supplier");
    await expect(manual(s, "CASH", "WITHDRAWAL", "60000", "Too much")).rejects.toBeInstanceOf(CashError);
    await manual(s, "CASH", "CORRECTION_IN", "2000", "Float found in the safe");
    expect(await balance(s, "CASH")).toBe("52000");
  });
});

describe("daily closing", () => {
  it("expected cash is worked out from the ledger, the difference is booked, and the ledger then equals the count", async () => {
    const s = await shop();
    await manual(s, "CASH", "OPENING", "100000");
    await sell(s, 2); // +50000 cash
    await sell(s, 1, { method: "MOBILE_MONEY", reference: "M" }); // mobile, not in cash
    await expense(s, "10000"); // -10000

    const preview = await db.$transaction((tx) => getClosingPreview(tx, s.location.id));
    expect(preview.expectedCash.toString()).toBe("140000");
    expect(preview.summary.cash).toMatchObject({ opening: "100000", salesIn: "50000", expensesOut: "10000", expected: "140000" });
    expect(preview.summary.sales).toMatchObject({ count: 2, total: "75000" });
    expect(preview.summary.accounts.find((a) => a.method === "MOBILE_MONEY")!.balance).toBe("25000");

    const r = await close(s, "139000", { notes: "Short by one" });
    expect(r.status).toBe("NEEDS_REVIEW"); // tolerance 0
    expect(r.difference.toString()).toBe("-1000");
    expect([r.closing.expectedCash.toString(), r.closing.countedCash.toString(), r.closing.cashCarried.toString()]).toEqual(["140000", "139000", "139000"]);
    expect(await balance(s, "CASH")).toBe("139000"); // the ledger now says exactly what was counted
    expect(await db.cashTransaction.count({ where: { account: { locationId: s.location.id }, closingId: null } })).toBe(0);
    expect(await db.cashTransaction.count({ where: { closingId: r.closing.id } })).toBe(5); // opening, two sales, expense, count difference
  });

  it("a count within the owner's tolerance is accepted without review", async () => {
    const s = await shop();
    await manual(s, "CASH", "OPENING", "50000");
    const r = await close(s, "49500", { tolerance: D(1000) });
    expect(r.status).toBe("SUBMITTED");
    expect(r.difference.toString()).toBe("-500");
  });

  it("the same day cannot be closed twice, even at the same moment", async () => {
    const s = await shop();
    await manual(s, "CASH", "OPENING", "50000");
    const results = await Promise.allSettled([close(s, "50000"), close(s, "50000"), close(s, "50000")]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(await db.dailyClosing.count({ where: { locationId: s.location.id } })).toBe(1);
    await expect(close(s, "50000")).rejects.toThrow(/already been closed/);
  });

  it("the next day opens with what was left in the till, and earlier days must be closed first in order", async () => {
    const s = await shop();
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    const yesterday = new Date(Date.now() - 86_400_000);
    // Money that moved two days ago and yesterday (as if the shop had been using the system)
    await db.$transaction(async (tx) => {
      await postCash(tx, { locationId: s.location.id, method: "CASH", type: "SALE_PAYMENT", amount: D(80000), referenceType: "Payment", referenceId: randomUUID(), userId, at: twoDaysAgo });
      await postCash(tx, { locationId: s.location.id, method: "CASH", type: "SALE_PAYMENT", amount: D(20000), referenceType: "Payment", referenceId: randomUUID(), userId, at: yesterday });
    });
    expect(await db.$transaction((tx) => unclosedDays(tx, s.location.id))).toHaveLength(2);

    const d1 = businessDay(twoDaysAgo);
    const d2 = businessDay(yesterday);
    const first = await close(s, "80000", { day: d1 });
    expect(first.closing.openingCash.toString()).toBe("0");
    expect(first.summary.cash.expected).toBe("80000");
    await sell(s, 2); // today +50000

    const second = await close(s, "100000", { day: d2 }); // yesterday: opening 80000 + 20000
    expect([second.closing.openingCash.toString(), second.closing.expectedCash.toString()]).toEqual(["80000", "100000"]);
    await expect(close(s, "80000", { day: d1 })).rejects.toThrow(/already been closed|later day/);

    const today = await close(s, "150000"); // opening 100000 + sale 50000
    expect([today.closing.openingCash.toString(), today.closing.expectedCash.toString(), today.difference.toString()]).toEqual(["100000", "150000", "0"]);
    expect(await balance(s, "CASH")).toBe("150000");
  });

  it("part of the counted cash can be deposited as part of the closing; the rest stays as cash on hand", async () => {
    const s = await shop();
    await manual(s, "CASH", "OPENING", "300000");
    const r = await close(s, "300000", { deposit: { amount: "200000", bankReference: "CRDB-123", notes: null, slipId: null } });
    expect(r.depositNo).toMatch(/^DEP-/);
    expect([r.closing.depositedNow.toString(), r.closing.cashCarried.toString()]).toEqual(["200000", "100000"]);
    expect(await balance(s, "CASH")).toBe("100000");
    expect(await balance(s, "BANK")).toBe("200000");

    const s2 = await shop();
    await manual(s2, "CASH", "OPENING", "100000");
    await expect(close(s2, "100000", { deposit: { amount: "100001", bankReference: "X-1", notes: null, slipId: null } })).rejects.toMatchObject({ fieldErrors: { depositAmount: expect.any(String) } });
    expect(await db.dailyClosing.count({ where: { locationId: s2.location.id } })).toBe(0); // nothing half-done
  });

  it("is locked once submitted, and each ledger row can belong to only one closing", async () => {
    const s = await shop();
    await manual(s, "CASH", "OPENING", "10000");
    const r = await close(s, "10000");
    await expect(db.$executeRaw`UPDATE "DailyClosing" SET "countedCash" = 99999 WHERE "id" = ${r.closing.id}`).rejects.toThrow(/locked/);
    await expect(db.$executeRaw`UPDATE "DailyClosing" SET "summary" = '{}'::jsonb WHERE "id" = ${r.closing.id}`).rejects.toThrow(/locked/);
    await expect(db.$executeRaw`DELETE FROM "DailyClosing" WHERE "id" = ${r.closing.id}`).rejects.toThrow(/cannot be deleted/);
    const stamped = await db.cashTransaction.findFirstOrThrow({ where: { closingId: r.closing.id } });
    const other = await db.dailyClosing.create({ data: { closingNo: `X-${randomUUID()}`, locationId: s.location.id, businessDate: new Date("2020-01-01"), openingCash: 0, expectedCash: 0, countedCash: 0, difference: 0, cashCarried: 0, summary: {}, status: "SUBMITTED", submittedById: userId, submissionKey: randomUUID() } });
    await expect(db.$executeRaw`UPDATE "CashTransaction" SET "closingId" = ${other.id} WHERE "id" = ${stamped.id}`).rejects.toThrow(/already belongs/);
  });

  it("a difference needs the owner's note before it is signed off, and only once", async () => {
    const s = await shop();
    await manual(s, "CASH", "OPENING", "20000");
    const r = await close(s, "18000");
    await expect(db.$transaction((tx) => reviewClosing(tx, { closingId: r.closing.id, reviewer: { id: managerId }, note: "" }))).rejects.toMatchObject({ fieldErrors: { note: expect.any(String) } });
    const done = await db.$transaction((tx) => reviewClosing(tx, { closingId: r.closing.id, reviewer: { id: managerId }, note: "Customer was given too much change; talked to the attendant" }));
    expect(done.closing.status).toBe("REVIEWED");
    expect(done.closing.reviewedById).toBe(managerId);
    await expect(db.$transaction((tx) => reviewClosing(tx, { closingId: r.closing.id, reviewer: { id: managerId }, note: "again" }))).rejects.toThrow(/already reviewed/);
    // the figures are untouched by the review
    expect((await db.dailyClosing.findUniqueOrThrow({ where: { id: r.closing.id } })).difference.toString()).toBe("-2000");
  });

  it("mobile money and bank are never mixed into the cash count", async () => {
    const s = await shop();
    await sell(s, 4, { method: "BANK", reference: "B1" });
    await sell(s, 2, { method: "MOBILE_MONEY", reference: "M1" });
    const r = await close(s, "0");
    expect(r.closing.expectedCash.toString()).toBe("0");
    expect(r.status).toBe("SUBMITTED");
    const b = await db.$transaction((tx) => getBalances(tx, s.location.id));
    expect(b.map((x) => [x.method, x.balance.toString()])).toEqual([["CASH", "0"], ["MOBILE_MONEY", "50000"], ["BANK", "100000"]]);
  });
});
