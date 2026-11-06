"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { fail, formString, formValues, guarded, zodErrors, type ActionState } from "@/lib/action";
import { accountBalance, defaultLocationId, lockAccount } from "@/lib/cash/ledger";
import { formatMoney } from "@/lib/money";
import { getCurrency } from "@/lib/settings";

const schema = z.object({
  id: z.string().max(40).optional(),
  method: z.enum(["MOBILE_MONEY", "BANK"]).optional(),
  name: z.string().trim().min(2, "Enter the account's name.").max(60, "Too long."),
  accountNumber: z.string().trim().max(40, "Too long."),
  holderName: z.string().trim().max(80, "Too long."),
});

const refresh = () => {
  for (const p of ["/cash", "/deposits", "/closing", "/pos", "/dashboard", "/payments", "/expenses"]) revalidatePath(p);
};

/** Adds a mobile-money or bank account (CRDB, NMB, M-PESA, Lipa...), or changes the name, number or holder of one. The till is the only cash account. */
export async function saveCashAccount(prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await saveAccount(prev, fd);
  if (result.ok && result.message?.startsWith("new:")) redirect(`/cash/${result.message.slice(4)}`); // a new account opens on its own page
  return result;
}

async function saveAccount(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  return guarded("cash.adjust", async (user) => {
    const parsed = schema.safeParse({
      id: formString(fd, "id") || undefined,
      method: formString(fd, "method") || undefined,
      name: formString(fd, "name"),
      accountNumber: formString(fd, "accountNumber"),
      holderName: formString(fd, "holderName"),
    });
    if (!parsed.success) return { ...zodErrors(parsed.error), values };
    const d = parsed.data;
    if (!d.id && !d.method) return fail("Please fix the highlighted fields.", { method: "Choose mobile money or bank." }, values);
    const locationId = await defaultLocationId(db);
    const dupe = await db.cashAccount.findFirst({ where: { locationId, name: { equals: d.name, mode: "insensitive" }, ...(d.id ? { NOT: { id: d.id } } : {}) }, select: { id: true } });
    if (dupe) return fail("Please fix the highlighted fields.", { name: "An account with this name already exists." }, values);

    let createdId: string | null = null;
    await db.$transaction(async (tx) => {
      if (!d.id) {
        const sameKind = await tx.cashAccount.count({ where: { locationId, method: d.method! } });
        const a = await tx.cashAccount.create({ data: { locationId, method: d.method!, name: d.name, accountNumber: d.accountNumber || null, holderName: d.holderName || null, isDefault: sameKind === 0 } });
        await writeAudit(tx, { user, action: "cash.account_create", entityType: "CashAccount", entityId: a.id, reference: a.name, after: { method: a.method, name: a.name, accountNumber: a.accountNumber, holderName: a.holderName } });
        createdId = a.id;
        return;
      }
      const before = await tx.cashAccount.findFirst({ where: { id: d.id, locationId } });
      if (!before) throw new AccountError("This account no longer exists.");
      await tx.cashAccount.update({ where: { id: before.id }, data: { name: d.name, accountNumber: d.accountNumber || null, holderName: d.holderName || null } });
      await writeAudit(tx, { user, action: "cash.account_update", entityType: "CashAccount", entityId: before.id, reference: d.name, before: { name: before.name, accountNumber: before.accountNumber, holderName: before.holderName }, after: { name: d.name, accountNumber: d.accountNumber || null, holderName: d.holderName || null } });
    }).catch((e) => {
      if (e instanceof AccountError) return fail(e.message, undefined, values);
      throw e;
    });
    refresh();
    return { ok: true, message: createdId ? `new:${createdId}` : "Saved." };
  });
}

class AccountError extends Error {}

/** Closes an account (only when it holds no money), opens it again, or makes it the main account of its type. */
export async function accountOpAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return guarded("cash.adjust", async (user) => {
    const id = formString(fd, "id");
    const op = formString(fd, "op");
    if (!id || !["close", "reopen", "default"].includes(op)) return fail("This request could not be read.");
    const locationId = await defaultLocationId(db);
    const currency = await getCurrency();
    try {
      await db.$transaction(async (tx) => {
        await lockAccount(tx, id);
        const a = await tx.cashAccount.findFirst({ where: { id, locationId } });
        if (!a) throw new AccountError("This account no longer exists.");
        if (op === "close") {
          if (a.method === "CASH") throw new AccountError("The till cannot be closed.");
          if (a.isDefault) throw new AccountError(`${a.name} is the main ${a.method === "BANK" ? "bank" : "mobile money"} account. Make another account the main one first.`);
          const bal = await accountBalance(tx, a.id);
          if (!bal.isZero()) throw new AccountError(`${a.name} still holds ${formatMoney(bal, currency)}. Move the money out first (a withdrawal or a correction, with the reason), then close it.`);
          await tx.cashAccount.update({ where: { id: a.id }, data: { status: "INACTIVE" } });
        } else if (op === "reopen") {
          await tx.cashAccount.update({ where: { id: a.id }, data: { status: "ACTIVE" } });
        } else {
          if (a.method === "CASH") throw new AccountError("The till is always the main cash account.");
          if (a.status !== "ACTIVE") throw new AccountError("Open this account again before making it the main one.");
          // one default per type: the old one is unset first, then this one is set
          await tx.cashAccount.updateMany({ where: { locationId, method: a.method, isDefault: true }, data: { isDefault: false } });
          await tx.cashAccount.update({ where: { id: a.id }, data: { isDefault: true } });
        }
        await writeAudit(tx, { user, action: `cash.account_${op}`, entityType: "CashAccount", entityId: a.id, reference: a.name });
      });
    } catch (e) {
      if (e instanceof AccountError) return fail(e.message);
      throw e;
    }
    refresh();
    return { ok: true, message: "Done." };
  });
}
