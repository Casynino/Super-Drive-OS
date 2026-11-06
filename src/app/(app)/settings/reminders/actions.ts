"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, formString, formValues, guarded, zodErrors, type ActionState } from "@/lib/action";
import { writeAudit } from "@/lib/audit";
import { runPaymentReminders } from "@/lib/credit/auto-reminders";
import { db } from "@/lib/db";

const schema = z.object({
  reminderAutoEnabled: z.boolean(),
  reminderEveryDays: z.coerce.number({ error: "Enter a number of days." }).int("Whole days only.").min(1, "1 or more.").max(60, "At most 60."),
  reminderTemplate: z.string().trim().regex(/^[a-z0-9_]{1,200}$/, "Use the template name exactly as in WhatsApp Manager: small letters, numbers and _ only."),
  reminderLanguage: z.string().trim().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, "Use a language code like sw or en."),
});

export async function saveReminderSettings(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  return guarded("settings.manage", async (user) => {
    const parsed = schema.safeParse({
      reminderAutoEnabled: fd.get("reminderAutoEnabled") === "on",
      reminderEveryDays: formString(fd, "reminderEveryDays") || "3",
      reminderTemplate: formString(fd, "reminderTemplate") || "payment_reminder",
      reminderLanguage: formString(fd, "reminderLanguage") || "sw",
    });
    if (!parsed.success) return { ...zodErrors(parsed.error), values };
    const next = parsed.data;
    const before = Object.fromEntries((await db.setting.findMany({ where: { key: { in: Object.keys(next) } } })).map((r) => [r.key, r.value]));
    await db.$transaction(async (tx) => {
      for (const [key, value] of Object.entries(next)) await tx.setting.upsert({ where: { key }, update: { value, updatedById: user.id }, create: { key, value, updatedById: user.id } });
      await writeAudit(tx, { user, action: "setting.update", entityType: "Setting", entityId: "paymentReminders", before, after: next });
    });
    revalidatePath("/settings/reminders");
    return { ok: true, message: "Saved." };
  });
}

/** Sends today's reminders now, to every customer on the "would get a reminder" list. Needs the box ticked: it messages real customers. */
export async function sendRemindersNowAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return guarded("settings.manage", async (user) => {
    if (fd.get("confirm") !== "on") return fail("Tick the box to confirm: this sends WhatsApp messages to real customers.");
    const result = await runPaymentReminders(db, { trigger: "MANUAL", requestedById: user.id });
    await writeAudit(db, { user, action: "reminder.send_manual", entityType: "PaymentReminder", entityId: "manual", after: { outcome: result.outcome, sent: result.sent, failed: result.failed, skipped: result.skipped } });
    revalidatePath("/settings/reminders");
    revalidatePath("/credit");
    return result.outcome === "sent" ? { ok: true, message: result.message } : fail(result.message);
  });
}
