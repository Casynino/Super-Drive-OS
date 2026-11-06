"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { fail, formString, formValues, guarded, isUniqueViolation, type ActionState } from "@/lib/action";
import { CashError } from "@/lib/cash/ledger";
import { transferMoney } from "@/lib/cash/transfer";
import { formatMoney } from "@/lib/money";
import { getCurrency } from "@/lib/settings";

/** The owner moves money from one of the shop's accounts to another. */
export async function moveMoneyAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  const result = await guarded("cash.adjust", async (user) => {
    const currency = await getCurrency();
    const submissionKey = formString(fd, "submissionKey");
    if (submissionKey.length < 16) return fail("The form could not be read. Reload the page and try again.", undefined, values);
    try {
      const r = await db.$transaction(
        async (tx) => {
          const m = await transferMoney(tx, { user, fromId: formString(fd, "fromId"), toId: formString(fd, "toId"), amount: formString(fd, "amount"), reason: formString(fd, "reason"), submissionKey, currencyDecimals: currency.decimals });
          await writeAudit(tx, { user, action: "cash.moved", entityType: "CashAccount", entityId: m.from.id, reference: `${m.from.name} → ${m.to.name}`, reason: m.reason, after: { amount: m.amount.toString(), from: m.from.name, to: m.to.name } });
          return m;
        },
        { timeout: 30000 },
      );
      revalidatePath("/cash");
      revalidatePath("/ledger");
      revalidatePath("/dashboard");
      return { ok: true, message: `${formatMoney(r.amount, currency)} moved from ${r.from.name} to ${r.to.name}.` };
    } catch (e) {
      if (e instanceof CashError) return fail(e.message, e.fieldErrors, values);
      if (isUniqueViolation(e)) return { ok: true, message: "This move was already saved." };
      throw e;
    }
  });
  if (result.ok && result.message) redirect(`/cash?moved=${encodeURIComponent(result.message)}`);
  return result;
}
