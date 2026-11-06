// Sending the daily report through CallMeBot (WhatsApp).
//  - The API key lives ONLY in the server environment (CALLMEBOT_API_KEY); it is never stored in the database,
//    sent to the browser, logged, or shown. The reporting number and schedule are settings the owner can change.
//  - Every message is a WhatsAppReport row. Scheduled rows are unique per day/kind/part, so a scheduler that runs
//    many times a day sends nothing twice. A job CLAIMS a row before sending it, so two jobs at the same moment
//    cannot both send it.
//  - Messages go out strictly in order; the first failure stops the run, the rest wait, and the next run resumes
//    from the failed message without re-sending the ones that arrived.
import type { ReportKind, ReportTrigger } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";
import { businessDay, dayToDate, defaultLocationId } from "@/lib/cash/ledger";
import { buildDailyReport } from "./daily";
import { appBaseUrl } from "./links";
import { buildPeriodMessage, shiftDay } from "./period";
import { cleanPhone, maskPhone } from "./format";

export type SendResult = { ok: boolean; error?: string };
export type Sender = (phone: string, text: string) => Promise<SendResult>;

const MAX_ATTEMPTS_PER_RUN = 3;
const MAX_ATTEMPTS_TOTAL = 8;
const GAP_MS = 2500; // CallMeBot rate-limits bursts
const STALE_CLAIM_MIN = 3;

/** The real sender. Never logs or returns the URL (it contains the key). */
export const callMeBotSender: Sender = async (phone, text) => {
  const key = process.env.CALLMEBOT_API_KEY;
  if (!key) return { ok: false, error: "The CallMeBot API key is not set on the server (CALLMEBOT_API_KEY)." };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15_000);
  try {
    const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(key)}`;
    const res = await fetch(url, { signal: ctl.signal, cache: "no-store" });
    const body = (await res.text()).slice(0, 400);
    if (!res.ok) return { ok: false, error: `CallMeBot answered ${res.status}.` };
    if (/error|invalid|not valid|wrong|failed/i.test(body.replace(/<[^>]+>/g, " "))) return { ok: false, error: `CallMeBot refused the message: ${body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.name === "AbortError" ? "CallMeBot did not answer in time." : "Could not reach CallMeBot." };
  } finally {
    clearTimeout(timer);
  }
};

export type ReportSettings = { phone: string; time: string; enabled: boolean; keyConfigured: boolean };

export async function getReportSettings(db: Pick<Db, "setting">): Promise<ReportSettings> {
  const rows = await db.setting.findMany({ where: { key: { in: ["reportPhone", "reportTime", "reportEnabled"] } } });
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const phone = typeof m.get("reportPhone") === "string" ? String(m.get("reportPhone")) : "";
  const time = typeof m.get("reportTime") === "string" && /^\d{2}:\d{2}$/.test(String(m.get("reportTime"))) ? String(m.get("reportTime")) : "20:00";
  return { phone, time, enabled: m.get("reportEnabled") === true, keyConfigured: Boolean(process.env.CALLMEBOT_API_KEY) };
}

const nowHm = (d: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Dar_es_Salaam" }).format(d);
const sleepReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type RunResult = {
  outcome: "sent" | "partial" | "failed" | "skipped";
  message: string;
  sent: number;
  total: number;
};

type PlannedRow = { kind: ReportKind; part: number; parts: number; content: string };

export async function runDailyReport(
  db: Db,
  input: { day?: string; trigger: ReportTrigger; requestedById?: string | null; sender?: Sender; sleep?: (ms: number) => Promise<void>; now?: Date; budgetMs?: number; /** the shop has just closed the day: send now, do not wait for the evening time */ afterClosing?: boolean },
): Promise<RunResult> {
  const sender = input.sender ?? callMeBotSender;
  const sleep = input.sleep ?? sleepReal;
  const now = input.now ?? new Date();
  const deadline = Date.now() + (input.budgetMs ?? 50_000);
  const settings = await getReportSettings(db);
  const phone = cleanPhone(settings.phone);
  const day = input.day ?? businessDay(now);

  if (!phone) return { outcome: "skipped", message: "No reporting number is set.", sent: 0, total: 0 };
  if (input.trigger === "SCHEDULED") {
    if (!settings.enabled) return { outcome: "skipped", message: "Daily reports are switched off.", sent: 0, total: 0 };
    if (day === businessDay(now) && nowHm(now) < settings.time && !input.afterClosing) return { outcome: "skipped", message: `Not time yet (reports go out at ${settings.time}).`, sent: 0, total: 0 };
  }

  // 1. The messages to send: reuse what a scheduled run already created for this day, otherwise build them now
  let rows: Row[] = [];
  if (input.trigger === "SCHEDULED") {
    const existing = await db.whatsAppReport.findMany({ where: { businessDate: dayToDate(day), trigger: "SCHEDULED" }, orderBy: [{ kind: "asc" }, { part: "asc" }] });
    const closedKinds = existing.filter((r) => r.kind !== "EXCEPTION");
    if (closedKinds.length > 0) {
      rows = closedKinds;
    } else {
      const locationId = await defaultLocationId(db);
      const report = await buildDailyReport(db, locationId, day);
      const planned: PlannedRow[] = report.closed
        ? [{ kind: "SUMMARY", part: 1, parts: 1, content: report.summary }, ...report.detail.map((c, i) => ({ kind: "DETAIL" as const, part: i + 1, parts: report.detail.length, content: c }))]
        : [{ kind: "EXCEPTION", part: 1, parts: 1, content: report.exception }];
      for (const p of planned) {
        // a unique clash means another run created it a moment ago: use that one
        await db.whatsAppReport.create({ data: { businessDate: dayToDate(day), trigger: "SCHEDULED", toPhone: maskPhone(phone), ...p } }).catch(() => undefined);
      }
      const kinds = planned.map((p) => p.kind);
      rows = await db.whatsAppReport.findMany({ where: { businessDate: dayToDate(day), trigger: "SCHEDULED", kind: { in: kinds } }, orderBy: [{ kind: "asc" }, { part: "asc" }] });
    }
  } else {
    const locationId = await defaultLocationId(db);
    const report = await buildDailyReport(db, locationId, day);
    const planned: PlannedRow[] = report.closed
      ? [{ kind: "SUMMARY", part: 1, parts: 1, content: report.summary }, ...report.detail.map((c, i) => ({ kind: "DETAIL" as const, part: i + 1, parts: report.detail.length, content: c }))]
      : [{ kind: "EXCEPTION", part: 1, parts: 1, content: report.exception }];
    for (const p of planned) rows.push(await db.whatsAppReport.create({ data: { businessDate: dayToDate(day), trigger: "MANUAL", requestedById: input.requestedById ?? null, toPhone: maskPhone(phone), ...p } }));
  }

  return deliver(db, rows, { phone, sender, sleep, deadline });
}

type Row = { id: string; status: string; attempts: number; content: string };

/** Sends the rows in order, claiming each one first; the first failure stops the run and the rest wait for the next run. */
async function deliver(db: Db, rows: Row[], o: { phone: string; sender: Sender; sleep: (ms: number) => Promise<void>; deadline: number }): Promise<RunResult> {
  const { phone, sender, sleep, deadline } = o;
  // 2. Send in order; stop at the first failure
  const total = rows.length;
  let sent = rows.filter((r) => r.status === "SENT").length;
  let sentNow = 0;
  let failure: string | null = null;
  for (const row of rows) {
    if (row.status === "SENT") continue;
    if (Date.now() > deadline) break;
    if (row.attempts >= MAX_ATTEMPTS_TOTAL) {
      failure = "A message failed too many times. Check the number and the API key, then send the report manually.";
      break;
    }
    // claim it: only one job can win this update
    const claimed = await db.$executeRaw`
      UPDATE "WhatsAppReport" SET "status" = 'SENDING', "claimedAt" = now()
       WHERE "id" = ${row.id} AND ("status" IN ('PENDING', 'FAILED') OR ("status" = 'SENDING' AND "claimedAt" < now() - make_interval(mins => ${STALE_CLAIM_MIN})))`;
    if (claimed === 0) continue; // someone else is sending (or already sent) this one

    let result: SendResult = { ok: false, error: "not sent" };
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_RUN; attempt++) {
      await db.whatsAppReport.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
      result = await sender(phone, row.content);
      if (result.ok) break;
      if (attempt < MAX_ATTEMPTS_PER_RUN) await sleep(1500 * attempt);
    }
    if (result.ok) {
      await db.whatsAppReport.update({ where: { id: row.id }, data: { status: "SENT", sentAt: new Date(), error: null } });
      sent++;
      sentNow++;
      await sleep(GAP_MS);
    } else {
      await db.whatsAppReport.update({ where: { id: row.id }, data: { status: "FAILED", error: (result.error ?? "Unknown error").slice(0, 300) } });
      failure = result.error ?? "A message could not be sent.";
      break;
    }
  }

  if (sent === total && total > 0) return { outcome: "sent", message: sentNow === 0 ? "Nothing new to send." : total === 1 ? "The message was sent." : `All ${total} messages were sent.`, sent, total };
  if (failure) return { outcome: sent > 0 ? "partial" : "failed", message: `${failure} ${sent} of ${total} sent. The rest will be tried again.`, sent, total };
  return { outcome: sent > 0 ? "partial" : "skipped", message: sent === total ? "Nothing new to send." : `${sent} of ${total} sent so far.`, sent, total };
}

/**
 * What the weekly and monthly reports cover (Nino, 2026-11-07): the WEEKLY report goes out on Sunday at 09:00 and covers the seven
 * days up to Saturday; the MONTHLY report goes out on the 1st at 09:00 and covers the whole month before.
 */
export function periodToSend(kind: "WEEKLY" | "MONTHLY", today: string): { from: string; to: string } {
  if (kind === "WEEKLY") {
    const to = shiftDay(today, -1);
    return { from: shiftDay(to, -6), to };
  }
  const to = shiftDay(`${today.slice(0, 8)}01`, -1);
  return { from: `${to.slice(0, 8)}01`, to };
}

export async function runPeriodReport(
  db: Db,
  input: { kind: "WEEKLY" | "MONTHLY"; trigger: ReportTrigger; requestedById?: string | null; sender?: Sender; sleep?: (ms: number) => Promise<void>; now?: Date; budgetMs?: number },
): Promise<RunResult> {
  const sender = input.sender ?? callMeBotSender;
  const sleep = input.sleep ?? sleepReal;
  const now = input.now ?? new Date();
  const deadline = Date.now() + (input.budgetMs ?? 50_000);
  const settings = await getReportSettings(db);
  const phone = cleanPhone(settings.phone);
  if (!phone) return { outcome: "skipped", message: "No reporting number is set.", sent: 0, total: 0 };
  if (input.trigger === "SCHEDULED" && !settings.enabled) return { outcome: "skipped", message: "WhatsApp reports are switched off.", sent: 0, total: 0 };

  const { from, to } = periodToSend(input.kind, businessDay(now));
  const date = dayToDate(to);
  let rows: Row[];
  if (input.trigger === "SCHEDULED") {
    // one scheduled row per period: a scheduler that runs twice sends it once, and a failed one is retried
    let existing = await db.whatsAppReport.findFirst({ where: { businessDate: date, trigger: "SCHEDULED", kind: input.kind } });
    if (!existing) {
      const content = await buildPeriodMessage(db, await defaultLocationId(db), input.kind, from, to, appBaseUrl());
      await db.whatsAppReport.create({ data: { businessDate: date, trigger: "SCHEDULED", toPhone: maskPhone(phone), kind: input.kind, part: 1, parts: 1, content } }).catch(() => undefined);
      existing = await db.whatsAppReport.findFirst({ where: { businessDate: date, trigger: "SCHEDULED", kind: input.kind } });
    }
    rows = existing ? [existing] : [];
  } else {
    const content = await buildPeriodMessage(db, await defaultLocationId(db), input.kind, from, to, appBaseUrl());
    rows = [await db.whatsAppReport.create({ data: { businessDate: date, trigger: "MANUAL", requestedById: input.requestedById ?? null, toPhone: maskPhone(phone), kind: input.kind, part: 1, parts: 1, content } })];
  }
  return deliver(db, rows, { phone, sender, sleep, deadline });
}
