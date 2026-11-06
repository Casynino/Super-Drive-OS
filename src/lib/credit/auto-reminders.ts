// Automatic WhatsApp payment reminders to customers (and winga) whose invoices are late.
//  - Sent through the WhatsApp Business Cloud API with an APPROVED template (the only way a system may start a chat).
//    The keys live ONLY in the server environment (WHATSAPP_CLOUD_TOKEN, WHATSAPP_PHONE_NUMBER_ID): never stored in the
//    database, shown in the app, logged or sent to the browser. Everything is OFF until the owner switches it on.
//  - At most ONE message per customer per day: a PaymentReminder row is created (claimed) BEFORE sending, so two jobs
//    running at once can never message the same person twice. A customer is not messaged again before `everyDays` days
//    have passed since their last reminder (automatic or one a person opened in WhatsApp).
//  - Only customers with an invoice past its due date and a balance, an active account and a real WhatsApp number.
//  - A failure for one customer does not stop the others; a failure that would hit everyone (bad token, template not
//    found) stops the run, and three failures in a row stop it too. Nothing here touches money or invoices.
import { Prisma, type ReportTrigger } from "@/generated/prisma/client";
import { writeAudit } from "@/lib/audit";
import { businessDay, dayToDate } from "@/lib/cash/ledger";
import type { Db } from "@/lib/db";
import { getCurrency } from "@/lib/settings";
import { maskPhone } from "@/lib/reports/format";
import { owedSql } from "@/lib/sales/owed";
import { REMINDER_ACTION, loadLastReminders, loadLateInvoices, templateParams, waNumber, type LateInvoice } from "./reminders";

export type SendResult = { ok: boolean; error?: string; id?: string; /** the problem would hit every message (bad token, template missing): stop the run */ fatal?: boolean };
export type Template = { name: string; language: string };
export type Sender = (to: string, template: Template, params: string[]) => Promise<SendResult>;

const GRAPH_VERSION = "v21.0";
const MAX_ATTEMPTS = 3;
const STALE_CLAIM_MIN = 3;
const GAP_MS = 350;
const FATAL_CODES = new Set([190, 10, 200, 132000, 132001, 132005, 132007, 132012, 132015, 132016]);

/** The real sender. The token is never put in an error or a log line. */
export const cloudApiSender: Sender = async (to, template, params) => {
  const token = process.env.WHATSAPP_CLOUD_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) return { ok: false, fatal: true, error: "The WhatsApp Business keys are not set on the server (WHATSAPP_CLOUD_TOKEN, WHATSAPP_PHONE_NUMBER_ID)." };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15_000);
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(phoneId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "template", template: { name: template.name, language: { code: template.language }, components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] } }),
      signal: ctl.signal,
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as { messages?: { id?: string }[]; error?: { message?: string; code?: number } } | null;
    const id = body?.messages?.[0]?.id;
    if (res.ok && id) return { ok: true, id };
    const code = body?.error?.code;
    return { ok: false, fatal: res.status === 401 || res.status === 403 || (code !== undefined && FATAL_CODES.has(code)), error: `WhatsApp refused the message${code ? ` (code ${code})` : ` (${res.status})`}: ${String(body?.error?.message ?? "no reason given").slice(0, 160)}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.name === "AbortError" ? "WhatsApp did not answer in time." : "Could not reach WhatsApp." };
  } finally {
    clearTimeout(timer);
  }
};

// ───────── Settings ─────────

export type ReminderSettings = { enabled: boolean; everyDays: number; template: string; language: string; keysConfigured: boolean };
const KEYS = ["reminderAutoEnabled", "reminderEveryDays", "reminderTemplate", "reminderLanguage"];

export async function getReminderSettings(db: Pick<Db, "setting">): Promise<ReminderSettings> {
  const m = new Map((await db.setting.findMany({ where: { key: { in: KEYS } } })).map((r) => [r.key, r.value]));
  const days = Number(m.get("reminderEveryDays"));
  const str = (k: string, d: string) => (typeof m.get(k) === "string" && String(m.get(k)).trim() ? String(m.get(k)).trim() : d);
  return {
    enabled: m.get("reminderAutoEnabled") === true,
    everyDays: Number.isInteger(days) && days >= 1 && days <= 60 ? days : 3,
    template: str("reminderTemplate", "payment_reminder"),
    language: str("reminderLanguage", "sw"),
    keysConfigured: Boolean(process.env.WHATSAPP_CLOUD_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
  };
}

// ───────── Who would be reminded ─────────

export type Candidate = { customerId: string; name: string; phone: string; invoices: LateInvoice[]; total: Prisma.Decimal; lastAt: Date | null };
export type Skipped = { customerId: string; name: string; reason: string };

const daysBetween = (fromYmd: string, toYmd: string) => Math.round((new Date(`${toYmd}T12:00:00Z`).getTime() - new Date(`${fromYmd}T12:00:00Z`).getTime()) / 86_400_000);

/** Customers with a late invoice, split into those that get a message now and those skipped (with the reason). Oldest debt first. */
export async function planReminders(db: Pick<Db, "$queryRaw" | "customer" | "auditLog" | "paymentReminder">, opts: { everyDays: number; now?: Date }): Promise<{ candidates: Candidate[]; skipped: Skipped[] }> {
  const now = opts.now ?? new Date();
  const today = businessDay(now);
  const owed = owedSql("s");
  const ids = (
    await db.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT s."customerId" AS id FROM "Sale" s
       WHERE s."status" = 'COMPLETED' AND s."customerId" IS NOT NULL AND s."dueDate" < ${today}::date AND ${owed} > 0`
  ).map((r) => r.id);
  if (ids.length === 0) return { candidates: [], skipped: [] };

  const [customers, late, last, doneToday] = await Promise.all([
    db.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, phone: true, status: true } }),
    loadLateInvoices(db, ids, today),
    loadLastReminders(db, ids),
    db.paymentReminder.findMany({ where: { customerId: { in: ids }, businessDate: dayToDate(today), status: { in: ["SENT", "SENDING"] } }, select: { customerId: true } }),
  ]);
  const handled = new Set(doneToday.map((r) => r.customerId));
  const candidates: Candidate[] = [];
  const skipped: Skipped[] = [];
  for (const c of customers) {
    const invoices = late.get(c.id) ?? [];
    if (invoices.length === 0) continue;
    const phone = waNumber(c.phone);
    const lastAt = last.get(c.id) ?? null;
    const since = lastAt ? daysBetween(businessDay(lastAt), today) : null;
    if (c.status !== "ACTIVE") skipped.push({ customerId: c.id, name: c.name, reason: "Customer is deactivated" });
    else if (!phone) skipped.push({ customerId: c.id, name: c.name, reason: "No valid WhatsApp number" });
    else if (handled.has(c.id)) skipped.push({ customerId: c.id, name: c.name, reason: "Already reminded today" });
    else if (since !== null && since < opts.everyDays) skipped.push({ customerId: c.id, name: c.name, reason: since === 0 ? "Reminded today" : `Reminded ${since} day${since === 1 ? "" : "s"} ago (every ${opts.everyDays} days)` });
    else candidates.push({ customerId: c.id, name: c.name, phone, invoices, total: invoices.reduce((s, i) => s.plus(i.owed), new Prisma.Decimal(0)), lastAt });
  }
  candidates.sort((a, b) => Math.max(...b.invoices.map((i) => i.days)) - Math.max(...a.invoices.map((i) => i.days)));
  return { candidates, skipped };
}

// ───────── The run ─────────

export type AutoResult = { outcome: "sent" | "partial" | "failed" | "skipped"; message: string; sent: number; failed: number; skipped: number };
const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
const sleepReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runPaymentReminders(db: Db, input: { trigger: ReportTrigger; requestedById?: string | null; sender?: Sender; sleep?: (ms: number) => Promise<void>; now?: Date; budgetMs?: number; maxPerRun?: number }): Promise<AutoResult> {
  const sender = input.sender ?? cloudApiSender;
  const sleep = input.sleep ?? sleepReal;
  const now = input.now ?? new Date();
  const deadline = Date.now() + (input.budgetMs ?? 50_000);
  const settings = await getReminderSettings(db);
  const none = (message: string, outcome: AutoResult["outcome"] = "skipped"): AutoResult => ({ outcome, message, sent: 0, failed: 0, skipped: 0 });

  if (input.trigger === "SCHEDULED" && !settings.enabled) return none("Automatic reminders are switched off.");
  if (!input.sender && !settings.keysConfigured) return none("WhatsApp Business is not connected yet: the keys are not set on the server.", "failed");

  const { candidates, skipped } = await planReminders(db, { everyDays: settings.everyDays, now });
  if (candidates.length === 0) return { outcome: "skipped", message: skipped.length ? `Nobody to remind now (${skipped.length} skipped).` : "Nobody has a late invoice.", sent: 0, failed: 0, skipped: skipped.length };

  const currency = await getCurrency();
  const today = businessDay(now);
  const date = dayToDate(today);
  const template: Template = { name: settings.template, language: settings.language };
  let sent = 0;
  let failed = 0;
  let skippedNow = skipped.length;
  let streak = 0;
  let stopped: string | null = null;

  for (const c of candidates.slice(0, input.maxPerRun ?? 40)) {
    if (Date.now() > deadline) {
      stopped = "Ran out of time; the rest will be sent on the next run.";
      break;
    }
    // 1. claim the customer for today BEFORE sending: only one job can win
    let rowId: string;
    try {
      rowId = (await db.paymentReminder.create({ data: { customerId: c.customerId, businessDate: date, trigger: input.trigger, status: "SENDING", saleIds: c.invoices.map((i) => i.id), totalOwed: c.total, toPhone: maskPhone(c.phone), requestedById: input.requestedById ?? null, claimedAt: now } })).id;
    } catch (e) {
      if (!isUnique(e)) throw e;
      const taken = await db.$executeRaw`
        UPDATE "PaymentReminder" SET "status" = 'SENDING', "claimedAt" = now()
         WHERE "customerId" = ${c.customerId} AND "businessDate" = ${today}::date
           AND (("status" = 'FAILED' AND "attempts" < ${MAX_ATTEMPTS}) OR ("status" = 'SENDING' AND "claimedAt" < now() - make_interval(mins => ${STALE_CLAIM_MIN})))`;
      if (taken === 0) {
        skippedNow++;
        continue;
      }
      rowId = (await db.paymentReminder.findUniqueOrThrow({ where: { customerId_businessDate: { customerId: c.customerId, businessDate: date } }, select: { id: true } })).id;
    }

    // 2. send
    await db.paymentReminder.update({ where: { id: rowId }, data: { attempts: { increment: 1 } } });
    const result = await sender(c.phone, template, templateParams({ customerName: c.name, invoices: c.invoices, currency }));
    if (result.ok) {
      await db.paymentReminder.update({ where: { id: rowId }, data: { status: "SENT", sentAt: new Date(), providerId: result.id ?? null, error: null } });
      const nos = await db.sale.findMany({ where: { id: { in: c.invoices.map((i) => i.id) } }, select: { saleNo: true }, orderBy: { saleNo: "asc" } });
      await writeAudit(db, { user: null, action: REMINDER_ACTION, entityType: "Customer", entityId: c.customerId, reference: c.name, after: { channel: "whatsapp-api", automatic: true, invoices: nos.map((n) => n.saleNo) } });
      sent++;
      streak = 0;
      await sleep(GAP_MS);
    } else {
      await db.paymentReminder.update({ where: { id: rowId }, data: { status: "FAILED", error: (result.error ?? "Unknown error").slice(0, 300) } });
      failed++;
      streak++;
      if (result.fatal || streak >= 3) {
        stopped = result.error ?? "Messages keep failing.";
        break;
      }
    }
  }

  const base = { sent, failed, skipped: skippedNow };
  if (stopped) return { outcome: sent > 0 ? "partial" : "failed", message: `${stopped} ${sent} sent, ${failed} failed.`, ...base };
  if (failed > 0) return { outcome: sent > 0 ? "partial" : "failed", message: `${sent} sent, ${failed} could not be sent (see the list below).`, ...base };
  return { outcome: "sent", message: sent === 1 ? "1 reminder was sent." : `${sent} reminders were sent.`, ...base };
}
