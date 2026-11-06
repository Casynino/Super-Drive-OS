"use server";

import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { fail, guarded, type ActionState } from "@/lib/action";
import { REMINDER_ACTION } from "@/lib/credit/reminders";
import { db } from "@/lib/db";

const schema = z.object({ customerId: z.string().min(1).max(40), saleIds: z.array(z.string().min(1).max(40)).min(1).max(100) });

/**
 * Records that a payment reminder was opened in WhatsApp for a customer, so the page can show "Reminded 3 days ago".
 * It only writes an audit row: it does not send anything and does not touch money or invoices.
 */
export async function logReminderAction(customerId: string, saleIds: string[]): Promise<ActionState> {
  return guarded("credit.view", async (user) => {
    const parsed = schema.safeParse({ customerId, saleIds });
    if (!parsed.success) return fail("This reminder could not be recorded.");
    const customer = await db.customer.findUnique({ where: { id: parsed.data.customerId }, select: { id: true, name: true } });
    if (!customer) return fail("This customer no longer exists.");
    // only invoices that really belong to this customer are written down
    const sales = await db.sale.findMany({ where: { id: { in: parsed.data.saleIds }, customerId: customer.id }, select: { saleNo: true }, orderBy: { saleNo: "asc" } });
    if (sales.length === 0) return fail("None of these invoices belong to this customer.");
    await writeAudit(db, { user, action: REMINDER_ACTION, entityType: "Customer", entityId: customer.id, reference: customer.name, after: { channel: "whatsapp", invoices: sales.map((s) => s.saleNo) } });
    return { ok: true };
  });
}
