"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { fail, formString, guarded, type ActionState } from "@/lib/action";
import { CollectionError, postCollection, postCreditApplication } from "@/lib/sales/collections";
import { getCurrency } from "@/lib/settings";

const allocationSchema = z.array(z.object({ saleId: z.string().min(1), amount: z.string().max(24) })).max(100);

const collectSchema = z.object({
  customerId: z.string().min(1),
  method: z.enum(["CASH", "MOBILE_MONEY", "BANK"], { error: "Choose how the customer paid." }),
  amount: z.string().max(24),
  reference: z.string().trim().max(80).nullable(),
  notes: z.string().trim().max(500).nullable(),
  allocations: allocationSchema,
  keepExtraAsCredit: z.boolean(),
  submissionKey: z.string().min(16).max(64),
});

const applySchema = z.object({
  customerId: z.string().min(1),
  notes: z.string().trim().max(500).nullable(),
  allocations: allocationSchema.min(1, "Choose the invoices to pay."),
  submissionKey: z.string().min(16).max(64),
});

function readPayload<T extends z.ZodType>(schema: T, fd: FormData): { ok: true; data: z.infer<T> } | { ok: false; state: ActionState } {
  try {
    const parsed = schema.safeParse(JSON.parse(formString(fd, "payloadJson") || "{}"));
    if (!parsed.success) return { ok: false, state: fail(parsed.error.issues[0]?.message ?? "The form could not be read. Reload the page and try again.") };
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, state: fail("The form could not be read. Reload the page and try again.") };
  }
}

// ───────────── Record a payment from a customer ─────────────

export async function recordCollection(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guarded("payments.record", async (user) => {
    const p = readPayload(collectSchema, fd);
    if (!p.ok) return p.state;
    const d = p.data;
    const currency = await getCurrency();

    try {
      const out = await db.$transaction(
        async (tx) => {
          const r = await postCollection(tx, { user, ...d, currencyDecimals: currency.decimals });
          const base = { user, entityType: "Payment", entityId: r.payment.id, reference: r.payment.paymentNo };
          await writeAudit(tx, {
            ...base,
            action: "payment.collect",
            after: { customerId: d.customerId, method: d.method, amount: r.payment.amount, allocated: r.allocated, invoices: r.invoices.map((i) => `${i.saleNo}: ${i.amount}`) },
          });
          if (r.extra.gt(0)) await writeAudit(tx, { ...base, action: "payment.advance_recorded", after: { customerId: d.customerId, extraKeptAsCredit: r.extra } });
          return r.payment;
        },
        { timeout: 30000, maxWait: 15000 },
      );
      revalidatePath("/customers", "layout");
      revalidatePath("/credit");
      revalidatePath("/sales");
      return { ok: true, message: out.id };
    } catch (e) {
      if (e instanceof CollectionError) return fail(e.message, e.fieldErrors);
      const existing = await db.payment.findUnique({ where: { submissionKey: d.submissionKey }, select: { id: true } });
      if (existing) return { ok: true, message: existing.id }; // double click: already recorded
      throw e;
    }
  });
  if (result.ok && result.message) redirect(`/payments/${result.message}?created=1`);
  return result;
}

// ───────────── Use a customer's advance credit on invoices ─────────────

export async function applyCustomerCredit(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guarded("payments.record", async (user) => {
    const p = readPayload(applySchema, fd);
    if (!p.ok) return p.state;
    const d = p.data;
    const currency = await getCurrency();

    try {
      const app = await db.$transaction(
        async (tx) => {
          const r = await postCreditApplication(tx, { user, ...d, currencyDecimals: currency.decimals });
          await writeAudit(tx, {
            user,
            action: "payment.credit_applied",
            entityType: "CreditApplication",
            entityId: r.application.id,
            reference: r.invoices.map((i) => i.saleNo).join(", "),
            after: { customerId: d.customerId, total: r.total, invoices: r.invoices.map((i) => `${i.saleNo}: ${i.amount}`) },
          });
          return r.application;
        },
        { timeout: 30000, maxWait: 15000 },
      );
      revalidatePath("/customers", "layout");
      revalidatePath("/credit");
      revalidatePath("/sales");
      return { ok: true, message: app.id };
    } catch (e) {
      if (e instanceof CollectionError) return fail(e.message, e.fieldErrors);
      const existing = await db.creditApplication.findUnique({ where: { submissionKey: d.submissionKey }, select: { id: true } });
      if (existing) return { ok: true, message: existing.id };
      throw e;
    }
  });
  if (result.ok) {
    const customerId = (() => {
      try {
        return JSON.parse(formString(fd, "payloadJson")).customerId as string;
      } catch {
        return "";
      }
    })();
    redirect(`/customers/${customerId}?creditApplied=1`);
  }
  return result;
}
