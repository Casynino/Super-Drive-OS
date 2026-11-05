"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { fail, formString, formValues, guarded, isUniqueViolation, type ActionState } from "@/lib/action";
import { CashError } from "@/lib/cash/ledger";
import { paySupplier } from "@/lib/cash/supplier";
import { formatMoney } from "@/lib/money";
import { getCurrency } from "@/lib/settings";

export async function paySupplierAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  const supplierId = formString(fd, "supplierId");
  const result = await guarded("suppliers.pay", async (user) => {
    const currency = await getCurrency();
    const method = formString(fd, "method");
    if (method !== "CASH" && method !== "MOBILE_MONEY" && method !== "BANK") return fail("Choose how it was paid.", { method: "Choose how it was paid." }, values);
    const submissionKey = formString(fd, "submissionKey");
    if (submissionKey.length < 16) return fail("The form could not be read. Reload the page and try again.", undefined, values);
    try {
      const r = await db.$transaction(
        async (tx) => {
          const out = await paySupplier(tx, { user, supplierId, shipmentId: formString(fd, "shipmentId") || null, amount: formString(fd, "amount"), method, reference: formString(fd, "reference"), notes: formString(fd, "notes") || null, submissionKey, currencyDecimals: currency.decimals });
          await writeAudit(tx, { user, action: "supplier.payment", entityType: "SupplierPayment", entityId: out.payment.id, reference: `${out.payment.paymentNo} · ${out.supplier.name}`, after: { amount: formatMoney(out.payment.amount, currency), method } });
          return out.payment.paymentNo;
        },
        { timeout: 30000, maxWait: 15000 },
      );
      revalidatePath(`/suppliers/${supplierId}`);
      revalidatePath("/suppliers");
      revalidatePath("/cash");
      return { ok: true, message: r };
    } catch (e) {
      if (e instanceof CashError) return fail(e.message, e.fieldErrors, values);
      if (isUniqueViolation(e)) {
        const existing = await db.supplierPayment.findUnique({ where: { submissionKey }, select: { paymentNo: true } });
        if (existing) return { ok: true, message: existing.paymentNo };
      }
      throw e;
    }
  });
  if (result.ok && result.message) redirect(`/suppliers/${supplierId}?paid=${encodeURIComponent(result.message)}`);
  return result;
}
