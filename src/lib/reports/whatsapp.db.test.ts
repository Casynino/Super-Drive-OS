import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { dayToDate, defaultLocationId } from "@/lib/cash/ledger";
import { runDailyReport, type Sender } from "./whatsapp";

let userId: string;
let locationId: string;
const noSleep = async () => {};
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+03:00`);

beforeAll(async () => {
  const role = await db.role.create({ data: { key: `T_${randomUUID()}`, name: "Test role" } });
  userId = (await db.user.create({ data: { username: `t_${randomUUID()}`, name: "Attendant", passwordHash: "x", roleId: role.id } })).id;
  await db.location.create({ data: { code: randomUUID().slice(0, 8).toUpperCase(), name: `Loc ${randomUUID()}` } }).catch(() => undefined);
  locationId = await defaultLocationId(db);
  for (const [key, value] of Object.entries({ reportPhone: "255712345678", reportTime: "20:00", reportEnabled: true })) await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
});

const summary = { businessDate: "x", sales: { count: 0, total: "0", paidByMethod: { CASH: "0", MOBILE_MONEY: "0", BANK: "0" }, creditGiven: "0", returnsCount: 0, returnsValue: "0" }, collections: { total: "0", byMethod: { CASH: "0", MOBILE_MONEY: "0", BANK: "0" } }, expenses: { total: "0", byCategory: [] }, cash: { opening: "0", salesIn: "0", collectionsIn: "0", refundsOut: "0", expensesOut: "0", withdrawals: "0", depositsOut: "0", corrections: "0", expected: "0" }, accounts: [], entries: 0 };
const closeDay = (day: string) =>
  db.dailyClosing.create({ data: { closingNo: `T-${randomUUID()}`, locationId, businessDate: dayToDate(day), openingCash: 0, expectedCash: 0, countedCash: 0, difference: 0, cashCarried: 0, summary, status: "SUBMITTED", submittedById: userId, submissionKey: randomUUID() } });

function recorder(failWhen: (text: string) => boolean = () => false) {
  const sent: string[] = [];
  const sender: Sender = async (_phone, text) => {
    if (failWhen(text)) return { ok: false, error: "CallMeBot did not answer in time." };
    sent.push(text);
    return { ok: true };
  };
  return { sent, sender };
}
// each test uses its own date so its rows never clash with another test's
const run = (day: string, sender: Sender, over: Partial<Parameters<typeof runDailyReport>[1]> = {}) => runDailyReport(db, { day, trigger: "SCHEDULED", sender, sleep: noSleep, now: at(day, "20:30"), ...over });

describe("the daily WhatsApp report", () => {
  it("sends the exception notice once when the shop has not closed, then the full report once the day is closed - never twice", async () => {
    const day = "2020-03-01";
    const a = recorder();
    expect((await run(day, a.sender)).outcome).toBe("sent");
    expect(a.sent).toHaveLength(1);
    expect(a.sent[0]).toContain("DAILY CLOSING PENDING");
    expect(a.sent[0]).toContain("NOT submitted");
    expect((await run(day, a.sender)).message).toMatch(/Nothing new/);
    expect(a.sent).toHaveLength(1); // the scheduler ran again: no second notice

    await closeDay(day);
    const b = recorder();
    expect((await run(day, b.sender)).outcome).toBe("sent");
    expect(b.sent[0]).toContain("DAILY BUSINESS SUMMARY");
    expect(b.sent[0]).toContain("Date: 01 March 2020");
    expect(b.sent[1]).toContain("DAILY DETAILED REPORT");
    expect(b.sent[1]).toMatch(/PART 1\/\d+/);
    await run(day, b.sender);
    expect(b.sent.length).toBe(1 + (await db.whatsAppReport.count({ where: { businessDate: dayToDate(day), kind: "DETAIL" } })));
    expect(await db.whatsAppReport.count({ where: { businessDate: dayToDate(day), status: { not: "SENT" } } })).toBe(0);
  });

  it("sends the messages in order, and after a failure resumes from the failed one without re-sending the ones that arrived", async () => {
    const day = "2020-03-02";
    await closeDay(day);
    const bad = recorder((t) => t.includes("DAILY DETAILED REPORT"));
    const r1 = await run(day, bad.sender);
    expect(r1.outcome).toBe("partial");
    expect(bad.sent).toHaveLength(1); // the summary arrived
    expect(bad.sent[0]).toContain("DAILY BUSINESS SUMMARY");
    const failed = await db.whatsAppReport.findFirstOrThrow({ where: { businessDate: dayToDate(day), status: "FAILED" } });
    expect([failed.kind, failed.part, failed.attempts]).toEqual(["DETAIL", 1, 3]); // controlled retries, then it stops
    expect(failed.error).toMatch(/did not answer/);

    const good = recorder();
    const r2 = await run(day, good.sender);
    expect(r2.outcome).toBe("sent");
    expect(good.sent.every((t) => t.includes("DAILY DETAILED REPORT"))).toBe(true); // the summary is NOT sent again
    expect(good.sent[0]).toMatch(/PART 1\//);
  });

  it("two jobs running at the same moment send each message once", async () => {
    const day = "2020-03-03";
    await closeDay(day);
    const sent: string[] = [];
    const slow: Sender = async (_p, text) => {
      await new Promise((r) => setTimeout(r, 120));
      sent.push(text);
      return { ok: true };
    };
    await Promise.all([run(day, slow), run(day, slow), run(day, slow)]);
    expect(new Set(sent).size).toBe(sent.length); // no message twice
    const rows = await db.whatsAppReport.findMany({ where: { businessDate: dayToDate(day) } });
    expect(rows.every((r) => r.status === "SENT")).toBe(true);
    expect(sent.length).toBe(rows.length);
  });

  it("respects the switch, the number and the time; a manual report ignores the schedule and never disturbs the scheduled one", async () => {
    const day = "2020-03-04";
    await closeDay(day);
    const a = recorder();
    expect((await run(day, a.sender, { now: at(day, "19:00") })).message).toMatch(/Not time yet/);
    expect(a.sent).toHaveLength(0);

    await db.setting.update({ where: { key: "reportEnabled" }, data: { value: false } });
    expect((await run(day, a.sender)).message).toMatch(/switched off/);
    const manual = await runDailyReport(db, { day, trigger: "MANUAL", requestedById: userId, sender: a.sender, sleep: noSleep, now: at(day, "12:00") });
    expect(manual.outcome).toBe("sent");
    expect(a.sent[0]).toContain("DAILY BUSINESS SUMMARY");
    expect(await db.whatsAppReport.count({ where: { businessDate: dayToDate(day), trigger: "SCHEDULED" } })).toBe(0);
    await db.setting.update({ where: { key: "reportEnabled" }, data: { value: true } });

    await db.setting.update({ where: { key: "reportPhone" }, data: { value: "" } });
    expect((await run(day, a.sender)).message).toMatch(/No reporting number/);
    await db.setting.update({ where: { key: "reportPhone" }, data: { value: "255712345678" } });
  });

  it("the log keeps only a masked number and never the API key", async () => {
    const day = "2020-03-05";
    await closeDay(day);
    process.env.CALLMEBOT_API_KEY = "super-secret-key-123";
    await run(day, recorder().sender);
    const rows = await db.whatsAppReport.findMany({ where: { businessDate: dayToDate(day) } });
    expect(rows.every((r) => r.toPhone === "2557…678")).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("super-secret-key-123");
    delete process.env.CALLMEBOT_API_KEY;
  });
});
