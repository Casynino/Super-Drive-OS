"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { fail, formString, formValues, guarded, isUniqueViolation, zodErrors, type ActionState } from "@/lib/action";
import { postManualCash } from "@/lib/cash/deposits";
import { CashError, defaultLocationId } from "@/lib/cash/ledger";
import { getCurrency } from "@/lib/settings";

const schema = z.object({
  accountId: z.string().min(1, "Choose the account.").max(40),
  kind: z.enum(["OPENING", "WITHDRAWAL", "CORRECTION_IN", "CORRECTION_OUT"]),
  amount: z.string().trim().min(1, "Enter the amount."),
  reason: z.string().trim().max(300),
  submissionKey: z.string().min(16),
});

// Opening balances, withdrawals by the owner and authorised corrections (owner / manager only).
export async function manualCashAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  const result = await guarded("cash.adjust", async (user) => {
    const parsed = schema.safeParse({ accountId: formString(fd, "accountId"), kind: formString(fd, "kind"), amount: formString(fd, "amount"), reason: formString(fd, "reason"), submissionKey: formString(fd, "submissionKey") });
    if (!parsed.success) return { ...zodErrors(parsed.error), values };
    const currency = await getCurrency();
    const account = await db.cashAccount.findUnique({ where: { id: parsed.data.accountId }, select: { method: true, name: true } });
    if (!account) return fail("Choose the account.", { accountId: "Choose the account." }, values);
    try {
      await db.$transaction(
        async (tx) => {
          const locationId = await defaultLocationId(tx);
          const row = await postManualCash(tx, { user, locationId, ...parsed.data, method: account.method, currencyDecimals: currency.decimals });
          await writeAudit(tx, { user, action: `cash.${parsed.data.kind.toLowerCase()}`, entityType: "CashTransaction", entityId: row.id, reference: account.name, reason: parsed.data.reason || undefined, after: { amount: row.amount.toString(), method: account.method, account: account.name } });
        },
        { timeout: 30000 },
      );
      revalidatePath("/cash");
      revalidatePath("/closing");
      revalidatePath("/dashboard");
      return { ok: true, message: "done" };
    } catch (e) {
      if (e instanceof CashError) return fail(e.message, e.fieldErrors, values);
      if (isUniqueViolation(e)) return { ok: true, message: "done" }; // the same form submitted twice
      throw e;
    }
  });
  if (result.ok) redirect("/cash?done=1");
  return result;
}
