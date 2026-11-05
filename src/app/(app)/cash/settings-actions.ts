"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { fail, formString, formValues, guarded, isUniqueViolation, zodErrors, type ActionState } from "@/lib/action";
import { parseMoney } from "@/lib/money";
import { getCurrency } from "@/lib/settings";

const amountField = (decimals: number) =>
  z.string().trim().transform((v, ctx) => {
    if (v === "") return "0";
    const d = parseMoney(v, decimals);
    if (!d || d.lt(0)) {
      ctx.addIssue({ code: "custom", message: decimals === 0 ? "Enter a whole amount (0 or more)." : "Enter an amount (0 or more)." });
      return z.NEVER;
    }
    return d.toString();
  });

export async function saveCashSettings(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  return guarded("settings.manage", async (user) => {
    const currency = await getCurrency();
    const parsed = z.object({ expenseApprovalLimit: amountField(currency.decimals), closingTolerance: amountField(currency.decimals) }).safeParse({
      expenseApprovalLimit: formString(fd, "expenseApprovalLimit"),
      closingTolerance: formString(fd, "closingTolerance"),
    });
    if (!parsed.success) return { ...zodErrors(parsed.error), values };
    const before = Object.fromEntries((await db.setting.findMany({ where: { key: { in: Object.keys(parsed.data) } } })).map((r) => [r.key, r.value]));
    await db.$transaction(async (tx) => {
      for (const [key, value] of Object.entries(parsed.data)) await tx.setting.upsert({ where: { key }, update: { value: Number(value), updatedById: user.id }, create: { key, value: Number(value), updatedById: user.id } });
      await writeAudit(tx, { user, action: "setting.update", entityType: "Setting", entityId: "cash", before, after: parsed.data });
    });
    revalidatePath("/settings");
    return { ok: true, message: "Saved." };
  });
}

export async function saveExpenseCategory(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  return guarded("settings.manage", async (user) => {
    const currency = await getCurrency();
    const parsed = z.object({ id: z.string().optional(), name: z.string().trim().min(2, "Enter a name.").max(60), approvalLimit: z.string().trim() }).safeParse({
      id: formString(fd, "id") || undefined,
      name: formString(fd, "name"),
      approvalLimit: formString(fd, "approvalLimit"),
    });
    if (!parsed.success) return { ...zodErrors(parsed.error), values };
    let limit: string | null = null;
    if (parsed.data.approvalLimit !== "") {
      const d = parseMoney(parsed.data.approvalLimit, currency.decimals);
      if (!d || d.lt(0)) return fail("Please fix the highlighted fields.", { approvalLimit: "Enter an amount (0 or more), or leave empty to use the general limit." }, values);
      limit = d.toString();
    }
    try {
      await db.$transaction(async (tx) => {
        const row = parsed.data.id
          ? await tx.expenseCategory.update({ where: { id: parsed.data.id }, data: { name: parsed.data.name, approvalLimit: limit } })
          : await tx.expenseCategory.create({ data: { name: parsed.data.name, approvalLimit: limit } });
        await writeAudit(tx, { user, action: parsed.data.id ? "expense_category.update" : "expense_category.create", entityType: "ExpenseCategory", entityId: row.id, reference: row.name, after: { name: row.name, approvalLimit: limit } });
      });
    } catch (e) {
      if (isUniqueViolation(e)) return fail("A category with this name already exists.", { name: "Already exists." }, values);
      throw e;
    }
    revalidatePath("/settings");
    revalidatePath("/expenses");
    return { ok: true, message: "Saved." };
  });
}

export async function setExpenseCategoryStatus(fd: FormData) {
  await guarded("settings.manage", async (user) => {
    const id = formString(fd, "id");
    const status = formString(fd, "status") === "INACTIVE" ? "INACTIVE" : "ACTIVE";
    await db.$transaction(async (tx) => {
      const row = await tx.expenseCategory.update({ where: { id }, data: { status } });
      await writeAudit(tx, { user, action: "expense_category.status", entityType: "ExpenseCategory", entityId: id, reference: row.name, after: { status } });
    });
    revalidatePath("/settings");
    return { ok: true };
  });
}
