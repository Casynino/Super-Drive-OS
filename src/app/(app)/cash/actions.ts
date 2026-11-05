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
  method: z.enum(["CASH", "MOBILE_MONEY", "BANK"]),
  kind: z.enum(["OPENING", "WITHDRAWAL", "CORRECTION_IN", "CORRECTION_OUT"]),
  amount: z.string().trim().min(1, "Enter the amount."),
  reason: z.string().trim().max(300),
  submissionKey: z.string().min(16),
});

// Opening balances, withdrawals by the owner and authorised corrections (owner / manager only).
export async function manualCashAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  const result = await guarded("cash.adjust", async (user) => {
    const parsed = schema.safeParse({ method: formString(fd, "method"), kind: formString(fd, "kind"), amount: formString(fd, "amount"), reason: formString(fd, "reason"), submissionKey: formString(fd, "submissionKey") });
    if (!parsed.success) return { ...zodErrors(parsed.error), values };
    const currency = await getCurrency();
    try {
      await db.$transaction(
        async (tx) => {
          const locationId = await defaultLocationId(tx);
          const row = await postManualCash(tx, { user, locationId, ...parsed.data, currencyDecimals: currency.decimals });
          await writeAudit(tx, { user, action: `cash.${parsed.data.kind.toLowerCase()}`, entityType: "CashTransaction", entityId: row.id, reference: parsed.data.method, reason: parsed.data.reason || undefined, after: { amount: row.amount.toString(), method: parsed.data.method } });
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
