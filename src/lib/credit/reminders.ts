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

const MONTHS = ["Januari", "Februari", "Machi", "Aprili", "Mei", "Juni", "Julai", "Agosti", "Septemba", "Oktoba", "Novemba", "Desemba"];
/** "2 Oktoba 2026" from a date-only value (the due date). */
export function swahiliDate(d: Date): string {
  const ymd = d.toISOString().slice(0, 10);
  return `${Number(ymd.slice(8, 10))} ${MONTHS[Number(ymd.slice(5, 7)) - 1]} ${ymd.slice(0, 4)}`;
}
const MAX_LISTED = 6;
/** formatMoney puts a non-breaking space after the symbol; messages use a plain one. */
const plain = (t: string) => t.replace(/[\u00a0\u202f]/g, " ");

type Frame = { business: string; phone: string; accounts: string; name: string; payment: string };

/** The reminder wording (Nino's template, Swahili). `payment` is the block under "TAARIFA ZA MALIPO". */
function frame(f: Frame): string {
  const accounts = f.accounts.trim();
  const call = f.phone.trim();
  return [
    `Habari ${f.name},`,
    "Tunatumaini unaendelea vizuri.",
    `Tunapenda kukukumbusha kuhusu malipo ya mzigo wako kutoka ${f.business} ambayo bado hayajakamilika.`,
    `TAARIFA ZA MALIPO\n${f.payment}`,
    ...(accounts ? [`TAARIFA ZA AKAUNTI ZA MALIPO\n\n${accounts}`] : []),
    "Baada ya kufanya malipo, tafadhali tutumie uthibitisho wa muamala ili tuweze kusasisha kumbukumbu za akaunti yako.",
    ...(call ? [`Kwa msaada au maelezo zaidi, tupigie simu au WhatsApp kupitia ${call}.`] : []),
    `Asante kwa kuendelea kushirikiana na ${f.business}. Tunathamini sana biashara yako!`,
  ].join("\n\n");
}

/** The message opened in WhatsApp for one customer: every late invoice with its amount, due date and days late, then the payment accounts. */
export function buildReminder(input: { businessName: string; businessPhone: string; paymentAccounts: string; customerName: string; invoices: LateInvoice[]; currency: CurrencyConfig }): string {
  const { invoices, currency } = input;
  const money = (v: Prisma.Decimal) => plain(formatMoney(v, currency));
  const shown = invoices.slice(0, MAX_LISTED);
  const more = invoices.length - shown.length;
  const blocks = shown.map((i) => [`• Ankara: ${i.saleNo}`, `• Kiasi kinachodaiwa: ${money(i.owed)}`, `• Tarehe ya mwisho ya malipo: ${swahiliDate(i.dueDate)}`, `• Muda uliopita: Siku ${i.days}`].join("\n"));
  let payment = blocks.join("\n\n");
  if (more > 0) payment += `\n\n• na ankara ${more} nyingine`;
  if (invoices.length > 1) payment += `\n\nJumla inayodaiwa: ${money(invoices.reduce((s, i) => s.plus(i.owed), new Prisma.Decimal(0)))}`;
  return frame({ business: input.businessName, phone: input.businessPhone, accounts: input.paymentAccounts, name: input.customerName, payment });
}

// ───────── The same wording as a WhatsApp Business template (for automatic sending) ─────────
// WhatsApp only lets a system start a conversation with an APPROVED template whose variables are single-line text.
// The template body is this text with {{1}}..{{5}}; the shop number, accounts and business name are written into it.

export const TEMPLATE_PAYMENT = ["• Ankara: {{2}}", "• Kiasi kinachodaiwa: {{3}}", "• Tarehe ya mwisho ya malipo: {{4}}", "• Muda uliopita: Siku {{5}}"].join("\n");
export const TEMPLATE_BODY_LIMIT = 1024;

/** The text to paste into the WhatsApp Business template (body). */
export function templateBody(p: { businessName: string; businessPhone: string; paymentAccounts: string }): string {
  return frame({ business: p.businessName, phone: p.businessPhone, accounts: p.paymentAccounts, name: "{{1}}", payment: TEMPLATE_PAYMENT });
}

const oneLine = (t: string, max: number) => t.replace(/\s+/g, " ").trim().slice(0, max);

/** The five template variables: name, invoice numbers, total owed, oldest due date, days late (oldest). Never contains a line break. */
export function templateParams(input: { customerName: string; invoices: LateInvoice[]; currency: CurrencyConfig }): string[] {
  const { invoices, currency } = input;
  const nos = invoices.slice(0, 5).map((i) => i.saleNo).join(", ") + (invoices.length > 5 ? ` na nyingine ${invoices.length - 5}` : "");
  const total = invoices.reduce((s, i) => s.plus(i.owed), new Prisma.Decimal(0));
  const oldest = invoices.reduce((o, i) => (i.dueDate < o.dueDate ? i : o), invoices[0]!);
  return [oneLine(input.customerName, 60), oneLine(nos, 140), plain(formatMoney(total, currency)), swahiliDate(oldest.dueDate), String(Math.max(...invoices.map((i) => i.days)))];
}

export function reminderLink(phone: string | null | undefined, text: string): string | null {
  const n = waNumber(phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}
