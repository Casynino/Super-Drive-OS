// Payment reminders for customers (and winga) who did not pay by the due date.
// WhatsApp does not let a system message customers on its own without the paid WhatsApp Business API, so the system
// prepares the message and opens the shop's own WhatsApp with it already written; the person only presses Send.
// Every time one is opened the system writes an audit row (credit.reminder), so the page can show "Reminded 3 days ago"
// and nobody is nagged twice by mistake. Nothing here touches money.
import { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";
import { formatMoney, type CurrencyConfig } from "@/lib/money";
import { owedSql } from "@/lib/sales/owed";

export const REMINDER_ACTION = "credit.reminder";

export type LateInvoice = { id: string; saleNo: string; dueDate: Date; days: number; owed: Prisma.Decimal };

/** International digits for wa.me ("0712 345 678" -> "255712345678"). Null when the number cannot be a phone number. */
export function waNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let d = phone.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = `255${d.slice(1)}`;
  else if (d.length === 9) d = `255${d}`;
  d = d.replace(/\D/g, "");
  return d.length >= 11 && d.length <= 15 ? d : null;
}

/** Late (past the due date) invoices that still have a balance, per customer, oldest first. */
export async function loadLateInvoices(db: Pick<Db, "$queryRaw">, customerIds: string[], today: string): Promise<Map<string, LateInvoice[]>> {
  const out = new Map<string, LateInvoice[]>();
  if (customerIds.length === 0) return out;
  const owed = owedSql("s");
  const rows = await db.$queryRaw<{ id: string; saleNo: string; customerId: string; dueDate: Date; days: number; owed: Prisma.Decimal | string }[]>`
    SELECT s."id", s."saleNo", s."customerId", s."dueDate", (${today}::date - s."dueDate")::int AS days, ${owed} AS owed
      FROM "Sale" s
     WHERE s."status" = 'COMPLETED' AND s."customerId" IN (${Prisma.join(customerIds)}) AND s."dueDate" < ${today}::date AND ${owed} > 0
     ORDER BY s."dueDate" ASC, s."createdAt" ASC`;
  for (const r of rows) {
    const list = out.get(r.customerId) ?? [];
    list.push({ id: r.id, saleNo: r.saleNo, dueDate: r.dueDate, days: r.days, owed: new Prisma.Decimal(r.owed.toString()) });
    out.set(r.customerId, list);
  }
  return out;
}

/** When each customer was last reminded (from the audit log). */
export async function loadLastReminders(db: Pick<Db, "auditLog">, customerIds: string[]): Promise<Map<string, Date>> {
  if (customerIds.length === 0) return new Map();
  const rows = await db.auditLog.groupBy({ by: ["entityId"], where: { action: REMINDER_ACTION, entityType: "Customer", entityId: { in: customerIds } }, _max: { createdAt: true } });
  return new Map(rows.filter((r) => r.entityId && r._max.createdAt).map((r) => [r.entityId!, r._max.createdAt!]));
}

/** "Reminded today", "Reminded yesterday", "Reminded 3 days ago". */
export function remindedText(at: Date | undefined, now = new Date()): string | null {
  if (!at) return null;
  const days = Math.floor((now.getTime() - at.getTime()) / 86_400_000);
  return days <= 0 ? "Reminded today" : days === 1 ? "Reminded yesterday" : `Reminded ${days} days ago`;
}

const dateText = (d: Date) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" }).format(d);
const MAX_LISTED = 6;

/** The message: Swahili first, then English, polite, with every late invoice and the shop's number to call. */
export function buildReminder(input: { businessName: string; businessPhone: string; customerName: string; invoices: LateInvoice[]; currency: CurrencyConfig }): string {
  const { businessName, businessPhone, customerName, invoices, currency } = input;
  const money = (v: Prisma.Decimal) => formatMoney(v, currency);
  const total = invoices.reduce((s, i) => s.plus(i.owed), new Prisma.Decimal(0));
  const shown = invoices.slice(0, MAX_LISTED);
  const more = invoices.length - shown.length;
  const sw = shown.map((i) => `• ${i.saleNo}: ${money(i.owed)} (ilitakiwa kulipwa ${dateText(i.dueDate)}, imechelewa siku ${i.days})`);
  const en = shown.map((i) => `• ${i.saleNo}: ${money(i.owed)} (due ${dateText(i.dueDate)}, ${i.days} day${i.days === 1 ? "" : "s"} late)`);
  if (more > 0) {
    sw.push(`• na ankara ${more} nyingine`);
    en.push(`• and ${more} more invoice${more === 1 ? "" : "s"}`);
  }
  const call = businessPhone.trim();
  return [
    `Habari ${customerName}, ni ${businessName}.`,
    `Tunakukumbusha kuwa una deni la ${money(total)} ambalo muda wake wa kulipa umepita:`,
    ...sw,
    `Tafadhali lipa mapema iwezekanavyo.${call ? ` Kwa maswali piga au tuma WhatsApp ${call}.` : ""} Asante.`,
    "",
    `Hello ${customerName}, this is ${businessName}.`,
    `A friendly reminder that ${money(total)} is overdue:`,
    ...en,
    `Please pay as soon as you can.${call ? ` Questions? Call or WhatsApp ${call}.` : ""} Thank you.`,
  ].join("\n");
}

export function reminderLink(phone: string | null | undefined, text: string): string | null {
  const n = waNumber(phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}
