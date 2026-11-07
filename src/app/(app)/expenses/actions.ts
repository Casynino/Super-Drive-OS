"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/auth/can";
import { fail, formString, formValues, guarded, isUniqueViolation, type ActionState } from "@/lib/action";
import { ImageError, processDocumentImage, saveAttachment } from "@/lib/cash/attachments";
import { decideExpense, recordExpense, reverseExpense } from "@/lib/cash/expenses";
import { CashError } from "@/lib/cash/ledger";
import { getCashSettings } from "@/lib/cash/settings";
import { formatMoney } from "@/lib/money";
import { notifyPermission, notifyUser } from "@/lib/notifications";
import { getCurrency } from "@/lib/settings";

const refresh = () => {
  revalidatePath("/expenses");
  revalidatePath("/approvals");
  revalidatePath("/dashboard");
  revalidatePath("/cash");
  revalidatePath("/closing");
  revalidatePath("/settings");
};

// ───────────── Record an expense (the attendant) ─────────────

export async function recordExpenseAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  const result = await guarded("expenses.create", async (user) => {
    const currency = await getCurrency();
    const settings = await getCashSettings(db);
    const accountId = formString(fd, "accountId") || null;
    // the account decides the method (older forms still send the method)
    const chosen = accountId ? await db.cashAccount.findUnique({ where: { id: accountId }, select: { method: true } }) : null;
    const method = chosen?.method ?? formString(fd, "method");
    if (method !== "CASH" && method !== "MOBILE_MONEY" && method !== "BANK") return fail("Choose where the money came from.", { accountId: "Choose where the money came from." }, values);
    const submissionKey = formString(fd, "submissionKey");
    if (submissionKey.length < 16) return fail("The form could not be read. Reload the page and try again.", undefined, values);

    let receipt: Buffer | null = null;
    const file = fd.get("receipt");
    if (file instanceof File && file.size > 0) {
      try {
        receipt = await processDocumentImage(Buffer.from(await file.arrayBuffer()));
      } catch (e) {
        if (e instanceof ImageError) return fail(e.message, { receipt: e.message }, values);
        throw e;
      }
    }
    // "Something else": a type that is not on the list yet (the owner only, same right as Settings → Expenses)
    const newTypeName = formString(fd, "newCategoryName").replace(/\s+/g, " ").trim();
    const pickedId = formString(fd, "categoryId");
    if (!pickedId && newTypeName) {
      if (!can(user, "settings.manage")) return fail("Only the owner can add a new type of expense. Pick one from the list.", { categoryId: "Pick one from the list." }, values);
      if (newTypeName.length < 2 || newTypeName.length > 60) return fail("Name the new type in 2 to 60 letters.", { categoryId: "Name the new type in 2 to 60 letters." }, values);
    }
    // "Details" is optional on the quick form: the category name stands in when it is left empty
    let description = formString(fd, "description");
    if (!description) {
      const name = !pickedId && newTypeName ? newTypeName : (await db.expenseCategory.findUnique({ where: { id: pickedId }, select: { name: true } }))?.name;
      if (name) description = name.length >= 3 ? name : `${name} expense`;
    }
    try {
      const out = await db.$transaction(
        async (tx) => {
          let categoryId = pickedId;
          if (!categoryId && newTypeName) {
            const same = await tx.expenseCategory.findFirst({ where: { name: { equals: newTypeName, mode: "insensitive" } } });
            if (same) {
              if (same.status !== "ACTIVE") throw new CashError("That type is switched off in Settings → Expenses.", { categoryId: "That type is switched off." });
              categoryId = same.id;
            } else {
              const row = await tx.expenseCategory.create({ data: { name: newTypeName } });
              await writeAudit(tx, { user, action: "expense_category.create", entityType: "ExpenseCategory", entityId: row.id, reference: row.name, after: { name: row.name, from: "record expense" } });
              categoryId = row.id;
            }
          }
          const att = receipt ? await saveAttachment(tx, { kind: "EXPENSE_RECEIPT", data: receipt, userId: user.id }) : null;
          const r = await recordExpense(tx, {
            user, categoryId, description, amount: formString(fd, "amount"), method, accountId, expenseDate: formString(fd, "expenseDate"),
            notes: formString(fd, "notes") || null, receiptId: att?.id ?? null, submissionKey, currencyDecimals: currency.decimals,
            approvalLimit: settings.expenseApprovalLimit, canApprove: can(user, "expenses.approve"),
          });
          await writeAudit(tx, {
            user, action: r.approvedNow ? "expense.recorded" : "expense.requested", entityType: "Expense", entityId: r.expense.id, reference: r.expense.expenseNo,
            after: { amount: r.expense.amount.toString(), category: r.categoryName, method, description },
          });
          if (!r.approvedNow) {
            await notifyPermission(tx, "expenses.approve", { type: "expense.requested", title: `Expense waiting for approval: ${formatMoney(r.expense.amount, currency)}`, body: `${user.name}: ${description} (${r.categoryName})`, link: "/expenses" }, user.id);
          }
          return r;
        },
        { timeout: 30000, maxWait: 15000 },
      );
      refresh();
      return { ok: true, message: `${out.expense.expenseNo}|${out.approvedNow ? "approved" : "pending"}` };
    } catch (e) {
      if (e instanceof CashError) return fail(e.message, e.fieldErrors, values);
      if (isUniqueViolation(e)) {
        const existing = await db.expense.findUnique({ where: { submissionKey }, select: { expenseNo: true, status: true } });
        if (existing) return { ok: true, message: `${existing.expenseNo}|${existing.status === "PENDING" ? "pending" : "approved"}` };
      }
      throw e;
    }
  });
  if (result.ok && result.message) {
    const [no, state] = result.message.split("|");
    redirect(`/expenses?recorded=${encodeURIComponent(no ?? "")}&state=${state}`);
  }
  return result;
}

// ───────────── Approve / reject (owner, manager) ─────────────

export async function decideExpenseAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return guarded("expenses.approve", async (user) => {
    const expenseId = formString(fd, "expenseId");
    const approve = formString(fd, "decision") === "approve";
    const note = formString(fd, "note");
    const currency = await getCurrency();
    try {
      await db.$transaction(
        async (tx) => {
          const r = await decideExpense(tx, { expenseId, approver: user, approve, note });
          await writeAudit(tx, { user, action: approve ? "expense.approved" : "expense.rejected", entityType: "Expense", entityId: expenseId, reference: r.expense.expenseNo, reason: note || undefined, after: { amount: r.expense.amount.toString() } });
          await notifyUser(tx, r.requestedById, {
            type: "expense.decided",
            title: `Your expense ${r.expense.expenseNo} was ${approve ? "approved" : "rejected"}`,
            body: approve ? `${formatMoney(r.expense.amount, currency)} may be paid out.` : note,
            link: `/expenses/${expenseId}`,
          });
        },
        { timeout: 30000 },
      );
      refresh();
      return { ok: true, message: approve ? "Approved." : "Rejected." };
    } catch (e) {
      if (e instanceof CashError) return fail(e.message, e.fieldErrors);
      throw e;
    }
  });
}

// ───────────── Reverse an approved expense (owner, manager) ─────────────

export async function reverseExpenseAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return guarded("expenses.approve", async (user) => {
    const expenseId = formString(fd, "expenseId");
    const reason = formString(fd, "reason");
    try {
      await db.$transaction(
        async (tx) => {
          const r = await reverseExpense(tx, { expenseId, by: user, reason });
          await writeAudit(tx, { user, action: "expense.reversed", entityType: "Expense", entityId: expenseId, reference: r.expense.expenseNo, reason, after: { amount: r.expense.amount.toString() } });
        },
        { timeout: 30000 },
      );
      refresh();
      return { ok: true, message: "The expense was reversed and the money put back." };
    } catch (e) {
      if (e instanceof CashError) return fail(e.message, e.fieldErrors);
      throw e;
    }
  });
}
