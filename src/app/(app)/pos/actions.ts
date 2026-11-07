"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/auth/can";
import { fail, guarded, formString, type ActionState } from "@/lib/action";
import { notifyStockCrossings } from "@/lib/inventory/alerts";
import { InsufficientStockError } from "@/lib/inventory/engine";
import { CreditLimitError, SaleError, postSale } from "@/lib/sales/post-sale";
import { getBusinessProfile, getCurrency } from "@/lib/settings";

const payloadSchema = z.object({
  customerId: z.string().min(1).nullable(),
  locationId: z.string().min(1, "Choose where the stock is sold from."),
  mode: z.enum(["FULL", "CREDIT", "PART"]),
  method: z.enum(["CASH", "MOBILE_MONEY", "BANK"]).nullable(),
  accountId: z.string().max(40).nullable().optional(),
  partAmount: z.string().max(20).nullable(),
  reference: z.string().trim().max(80).nullable(),
  notes: z.string().trim().max(500).nullable(),
  discountReason: z.string().trim().max(200).nullable(),
  lines: z
    .array(z.object({ productId: z.string().min(1), unitId: z.string().min(1), quantity: z.string().max(24), unitPrice: z.string().max(24), itemCodes: z.array(z.string().max(64)).max(1000).optional() }))
    .min(1, "Add at least one product.")
    .max(100),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  creditException: z.object({ reason: z.string().trim().min(5, "Give a reason for the exception (at least 5 characters).").max(300) }).nullable(),
  submissionKey: z.string().min(16).max(64),
});

export async function createSale(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guarded("sales.pos", async (user) => {
    let payload: z.infer<typeof payloadSchema>;
    try {
      const parsed = payloadSchema.safeParse(JSON.parse(formString(fd, "payloadJson") || "{}"));
      if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "The sale could not be read. Reload the page and try again.");
      payload = parsed.data;
    } catch {
      return fail("The sale could not be read. Reload the page and try again.");
    }

    const location = await db.location.findFirst({ where: { id: payload.locationId, status: "ACTIVE" } });
    if (!location) return fail("Choose an active location to sell from.");
    const [currency, profile] = await Promise.all([getCurrency(), getBusinessProfile()]);

    // Goods taken on credit by a normal customer: the till must say the day they will pay (a Winga pays within their own pay period).
    if (payload.mode !== "FULL" && payload.customerId && !payload.dueDate) {
      const isWinga = await db.reseller.findFirst({ where: { customerId: payload.customerId }, select: { id: true } });
      if (!isWinga) return fail("Choose the day the customer will pay.", { dueDate: "Choose the day the customer will pay." });
    }

    try {
      const done = await db.$transaction(
        async (tx) => {
          const r = await postSale(tx, {
            user,
            can: { discount: can(user, "sales.discount"), credit: can(user, "sales.credit"), approveCreditException: can(user, "credit.approve_exception") },
            customerId: payload.customerId,
            locationId: location.id,
            mode: payload.mode,
            method: payload.mode === "CREDIT" ? null : payload.method,
            accountId: payload.mode === "CREDIT" ? null : payload.accountId || null,
            partAmount: payload.partAmount,
            reference: payload.reference || null,
            notes: payload.notes || null,
            discountReason: payload.discountReason || null,
            lines: payload.lines,
            creditException: payload.creditException,
            dueDate: payload.mode === "FULL" ? null : (payload.dueDate ?? null),
            creditDetailsRequired: true,
            submissionKey: payload.submissionKey,
            currencyDecimals: currency.decimals,
            creditTermsDays: profile.creditTermsDays,
          });
          const base = { user, entityType: "Sale", entityId: r.sale.id, reference: r.sale.saleNo };
          await writeAudit(tx, {
            ...base,
            action: "sale.create",
            after: { total: r.sale.total, paid: r.sale.amountPaid, onCredit: r.onCredit, status: r.sale.paymentStatus, customerId: r.sale.customerId, location: location.name, lines: payload.lines.length },
          });
          if (r.sale.discountTotal.gt(0)) await writeAudit(tx, { ...base, action: "sale.discount_given", reason: r.sale.discountReason, after: { discountTotal: r.sale.discountTotal, subtotal: r.sale.subtotal } });
          if (r.creditExceptionUsed) {
            await writeAudit(tx, { ...base, action: "credit.exception_approved", reason: r.sale.creditExceptionReason, after: { customerId: r.sale.customerId, creditSale: r.onCredit } });
          }
          // stock that left at once (SOLD rows) or, from the warehouse, stock that was reserved for the pickup note
          const sold = r.pickup
            ? (await tx.pickupNoteItem.findMany({ where: { noteId: r.pickup.id }, select: { productId: true, quantity: true } })).map((m) => ({ productId: m.productId, qty: m.quantity }))
            : (await tx.stockMovement.findMany({ where: { referenceType: "Sale", referenceId: r.sale.id, type: "SOLD" }, select: { productId: true, quantity: true } })).map((m) => ({ productId: m.productId, qty: m.quantity.neg() }));
          await notifyStockCrossings(tx, sold, `After sale ${r.sale.saleNo}`);
          if (r.pickup) await writeAudit(tx, { ...base, action: "pickup.created", entityType: "PickupNote", entityId: r.pickup.id, reference: r.pickup.noteNo, after: { sale: r.sale.saleNo, auth: r.pickup.auth } });
          return r.sale;
        },
        { timeout: 30000, maxWait: 15000 },
      );
      revalidatePath("/sales");
      revalidatePath("/inventory", "layout");
      return { ok: true, message: done.id };
    } catch (e) {
      if (e instanceof CreditLimitError) return fail(e.message, { customer: e.message });
      if (e instanceof SaleError) return fail(e.message, e.fieldErrors);
      if (e instanceof InsufficientStockError) {
        const p = await db.product.findUnique({ where: { id: e.productId }, include: { baseUnit: true } });
        return fail(`Not enough stock of ${p?.name ?? "a product"} at ${location.name}: ${e.available.toString()} ${p?.baseUnit.symbol ?? ""} available, ${e.requested.toString()} needed.`);
      }
      // Double click / retry of the same form: it was already saved, so just show it.
      const existing = await db.sale.findUnique({ where: { submissionKey: payload.submissionKey }, select: { id: true } });
      if (existing) return { ok: true, message: existing.id };
      throw e;
    }
  });
  // The till stays where it is: the screen shows the "Sale complete" pop-up for this sale (message = the sale id).
  return result;
}
