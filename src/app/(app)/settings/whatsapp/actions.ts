"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { fail, formString, formValues, guarded, zodErrors, type ActionState } from "@/lib/action";
import { cleanPhone } from "@/lib/reports/format";
import { runDailyReport } from "@/lib/reports/whatsapp";
import { businessDay } from "@/lib/cash/ledger";

export async function saveReportSettings(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  return guarded("settings.manage", async (user) => {
    const parsed = z.object({ reportPhone: z.string().trim(), reportTime: z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use the 24-hour format, e.g. 20:00."), reportEnabled: z.boolean() }).safeParse({
      reportPhone: formString(fd, "reportPhone"),
      reportTime: formString(fd, "reportTime") || "20:00",
      reportEnabled: fd.get("reportEnabled") === "on",
    });
    if (!parsed.success) return { ...zodErrors(parsed.error), values };
    const phone = parsed.data.reportPhone === "" ? "" : cleanPhone(parsed.data.reportPhone);
    if (phone === null) return fail("Please fix the highlighted fields.", { reportPhone: "Enter the number in international format, e.g. 255712345678." }, values);
    const next = { reportPhone: phone, reportTime: parsed.data.reportTime, reportEnabled: parsed.data.reportEnabled };
    const before = Object.fromEntries((await db.setting.findMany({ where: { key: { in: Object.keys(next) } } })).map((r) => [r.key, r.value]));
    await db.$transaction(async (tx) => {
      for (const [key, value] of Object.entries(next)) await tx.setting.upsert({ where: { key }, update: { value, updatedById: user.id }, create: { key, value, updatedById: user.id } });
      await writeAudit(tx, { user, action: "setting.update", entityType: "Setting", entityId: "whatsappReport", before: { ...before, reportPhone: before.reportPhone ? "set" : "empty" }, after: { ...next, reportPhone: next.reportPhone ? "set" : "empty" } });
    });
    revalidatePath("/settings/whatsapp");
    return { ok: true, message: "Saved." };
  });
}

export async function sendReportNowAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return guarded("settings.manage", async (user) => {
    const day = formString(fd, "day") || businessDay();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > businessDay()) return fail("Choose a day that has already started.");
    const result = await runDailyReport(db, { day, trigger: "MANUAL", requestedById: user.id });
    await db.$transaction((tx) => writeAudit(tx, { user, action: "report.send_manual", entityType: "WhatsAppReport", entityId: day, reference: day, after: { outcome: result.outcome, sent: result.sent, total: result.total } }));
    revalidatePath("/settings/whatsapp");
    return result.outcome === "sent" ? { ok: true, message: result.message } : fail(result.message);
  });
}
