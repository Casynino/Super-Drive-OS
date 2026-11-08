import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { postReceipt } from "@/lib/inventory/documents";
import { resolveLines } from "@/lib/inventory/lines";
import { postSale } from "@/lib/sales/post-sale";
import { planReminders, runPaymentReminders, type Sender } from "./auto-reminders";
import { loadLastReminders } from "./reminders";

const D = (v: string | number) => new Prisma.Decimal(v);
let userId: string;
let unit: string;
let categoryId: string;

const setSetting = (key: string, value: unknown) => db.setting.upsert({ where: { key }, update: { value: value as Prisma.InputJsonValue }, create: { key, value: value as Prisma.InputJsonValue } });

beforeAll(async () => {
  const role = await db.role.create({ data: { key: `T_${randomUUID()}`, name: "Test role" } });
  userId = (await db.user.create({ data: { username: `t_${randomUUID()}`, email: `t_${randomUUID()}@test.local`, name: "Cashier", passwordHash: "x", roleId: role.id } })).id;
  unit = (await db.unit.create({ data: { name: `Bottle ${randomUUID()}`, symbol: randomUUID().slice(0, 8) } })).id;
  categoryId = (await db.category.create({ data: { name: `Cat ${randomUUID()}` } })).id;
  await setSetting("reminderAutoEnabled", true);
  await setSetting("reminderEveryDays", 3);
  await setSetting("reminderTemplate", "payment_reminder");
  await setSetting("reminderLanguage", "sw");
});

/** A customer with a phone, plus a credit invoice that is `late` days past its due date (or still `-late` days away). */
async function lateCustomer(opts: { late?: number; phone?: string | null; status?: "ACTIVE" | "INACTIVE" } = {}) {
  const location = await db.location.create({ data: { code: randomUUID().slice(0, 8).toUpperCase(), name: `Loc ${randomUUID()}` } });
  const product = await db.product.create({ data: { sku: `SKU-${randomUUID()}`, name: "Test oil", categoryId, baseUnitId: unit, purchasePrice: 10000, sellingPrice: 25000 } });
  await db.$transaction(async (tx) => {
    const r = await resolveLines(tx, [{ productId: product.id, unitId: unit, quantity: "100" }]);
    if (!r.ok) throw new Error(r.message);
    await postReceipt(tx, { type: "OPENING_STOCK", supplierId: null, locationId: location.id, supplierInvoice: null, receivedDate: new Date(), notes: null, submissionKey: randomUUID(), lines: r.lines.map((l) => ({ ...l, lineTotal: D(1_000_000) })), user: { id: userId } });
  });
  const phone = opts.phone === undefined ? `0712${String(Math.floor(Math.random() * 900000) + 100000)}` : opts.phone;
  const customer = await db.customer.create({ data: { name: `Cust ${randomUUID().slice(0, 8)}`, phone: phone ?? "0712 000 111", creditLimit: 10_000_000 } });
  await db.$transaction(
    (tx) =>
      postSale(tx, {
        user: { id: userId },
        can: { discount: false, credit: true, approveCreditException: false },
        customerId: customer.id,
        locationId: location.id,
        mode: "CREDIT",
        method: null,
        partAmount: null,
        reference: null,
        notes: null,
        lines: [{ productId: product.id, unitId: unit, quantity: "4", unitPrice: "" }],
        creditException: null,
        submissionKey: randomUUID(),
        currencyDecimals: 0,
        creditTermsDays: -(opts.late ?? 5), // a negative term puts the due date in the past
      }),
    { timeout: 30000 },
  );
  // the sale needs a phone to be made; tests of "no valid number" change it afterwards
  if (phone === null || opts.status === "INACTIVE" || (phone && phone.length < 10)) await db.customer.update({ where: { id: customer.id }, data: { phone, ...(opts.status ? { status: opts.status } : {}) } });
  return { customer, phone: phone ?? null };
}

const wa = (phone: string) => `255${phone.replace(/^0/, "").replace(/\s/g, "")}`;

function fakeSender(behaviour: (to: string) => { ok: boolean; error?: string; fatal?: boolean } = () => ({ ok: true })) {
  const calls: { to: string; params: string[]; template: string }[] = [];
  const sender: Sender = async (to, template, params) => {
    calls.push({ to, params, template: `${template.name}/${template.language}` });
    const r = behaviour(to);
    return r.ok ? { ok: true, id: `wamid.${calls.length}` } : r;
  };
  return { calls, sender };
}
const run = (sender: Sender, over: Partial<Parameters<typeof runPaymentReminders>[1]> = {}) => runPaymentReminders(db, { trigger: "MANUAL", sender, sleep: async () => undefined, ...over });
const callsTo = <T extends { to: string }>(calls: T[], phone: string) => calls.filter((c) => c.to === wa(phone));

describe("automatic payment reminders", () => {
  it("messages a customer with a late invoice once, using the approved template, and writes it down", async () => {
    const { customer, phone } = await lateCustomer({ late: 12 });
    const { calls, sender } = fakeSender();
    await run(sender);
    const mine = callsTo(calls, phone!);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.template).toBe("payment_reminder/sw");
    expect(mine[0]!.params).toHaveLength(5);
    expect(mine[0]!.params[0]).toBe(customer.name);
    expect(mine[0]!.params[4]).toBe("12"); // days late
    mine[0]!.params.forEach((p) => expect(p).not.toMatch(/[\n\t]/));

    const row = await db.paymentReminder.findFirstOrThrow({ where: { customerId: customer.id } });
    expect(row.status).toBe("SENT");
    expect(row.providerId).toMatch(/^wamid\./);
    expect(row.totalOwed.toString()).toBe("100000"); // 4 bottles at 25,000
    expect(row.toPhone).not.toContain(phone!.slice(4, 8)); // the number is masked in the log
    expect((await loadLastReminders(db, [customer.id])).get(customer.id)).toBeInstanceOf(Date); // the Credit page shows "Reminded today"
  });

  it("never messages the same customer twice in a day, even when two runs start together", async () => {
    const { customer, phone } = await lateCustomer();
    const { calls, sender } = fakeSender();
    await Promise.all([run(sender), run(sender)]);
    await run(sender);
    expect(callsTo(calls, phone!)).toHaveLength(1);
    expect(await db.paymentReminder.count({ where: { customerId: customer.id } })).toBe(1);
  });

  it("leaves out invoices that are not late yet, numbers that cannot be WhatsApp numbers and deactivated customers, and says why", async () => {
    const early = await lateCustomer({ late: -10 }); // due in 10 days
    const bad = await lateCustomer({ phone: "123" });
    const off = await lateCustomer({ status: "INACTIVE" });
    const plan = await planReminders(db, { everyDays: 3 });
    const ids = (xs: { customerId: string }[]) => xs.map((x) => x.customerId);
    expect(ids(plan.candidates)).not.toContain(early.customer.id);
    expect(ids(plan.candidates)).not.toContain(bad.customer.id);
    expect(ids(plan.candidates)).not.toContain(off.customer.id);
    expect(plan.skipped.find((x) => x.customerId === bad.customer.id)?.reason).toMatch(/WhatsApp number/);
    expect(plan.skipped.find((x) => x.customerId === off.customer.id)?.reason).toMatch(/deactivated/);
    expect(plan.skipped.find((x) => x.customerId === early.customer.id)).toBeUndefined(); // not late: not even on the list
  });

  it("waits the chosen number of days before reminding again", async () => {
    const { phone } = await lateCustomer({ late: 2 });
    const { calls, sender } = fakeSender();
    await run(sender);
    const day = 86_400_000;
    await run(sender, { now: new Date(Date.now() + day) });
    await run(sender, { now: new Date(Date.now() + 2 * day) });
    expect(callsTo(calls, phone!)).toHaveLength(1);
    await run(sender, { now: new Date(Date.now() + 3 * day) });
    expect(callsTo(calls, phone!)).toHaveLength(2);
  });

  it("records a failed send and tries that customer again on the next run", async () => {
    const { customer, phone } = await lateCustomer();
    let healthy = false;
    const { calls, sender } = fakeSender((to) => (to === wa(phone!) && !healthy ? { ok: false, error: "Recipient is not on WhatsApp" } : { ok: true }));
    const first = await run(sender);
    expect(first.failed).toBeGreaterThanOrEqual(1);
    const failed = await db.paymentReminder.findFirstOrThrow({ where: { customerId: customer.id } });
    expect(failed.status).toBe("FAILED");
    expect(failed.error).toContain("not on WhatsApp");
    healthy = true;
    await run(sender);
    const after = await db.paymentReminder.findFirstOrThrow({ where: { customerId: customer.id } });
    expect(after.status).toBe("SENT");
    expect(after.attempts).toBe(2);
    expect(callsTo(calls, phone!)).toHaveLength(2);
    expect(await db.paymentReminder.count({ where: { customerId: customer.id } })).toBe(1);
  });

  it("stops the whole run when the problem would hit everyone (bad token)", async () => {
    await lateCustomer();
    await lateCustomer();
    const { calls, sender } = fakeSender(() => ({ ok: false, fatal: true, error: "WhatsApp refused the message (code 190): invalid token" }));
    const r = await run(sender);
    expect(r.outcome).toBe("failed");
    expect(calls).toHaveLength(1);
  });

  it("does nothing on the morning run while automatic reminders are switched off, and refuses without the server keys", async () => {
    await lateCustomer();
    await setSetting("reminderAutoEnabled", false);
    const { calls, sender } = fakeSender();
    const off = await run(sender, { trigger: "SCHEDULED" });
    expect(off.outcome).toBe("skipped");
    expect(calls).toHaveLength(0);
    await setSetting("reminderAutoEnabled", true);
    const noKeys = await runPaymentReminders(db, { trigger: "MANUAL" }); // real sender, but no keys in the test environment
    expect(noKeys.outcome).toBe("failed");
    expect(noKeys.message).toMatch(/keys are not set/i);
  });
});
