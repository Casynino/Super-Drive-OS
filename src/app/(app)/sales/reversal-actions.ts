"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/auth/can";
import { fail, formString, guarded, type ActionState } from "@/lib/action";
import { notifyPermission, notifyUser } from "@/lib/notifications";
import { ReversalError, completeReversal, createReversalRequest, rejectReversal } from "@/lib/sales/reversals";
import { getCurrency } from "@/lib/settings";

const requestSchema = z.object({
  saleId: z.string().min(1),
  kind: z.enum(["RETURN", "CANCEL"]),
  reason: z.string().trim().max(300),
  refundMethod: z.enum(["CASH", "MOBILE_MONEY", "BANK"]).nullable(),
  refundReference: z.string().trim().max(80).nullable(),
  lines: z.array(z.object({ saleItemId: z.string().min(1), quantity: z.string().max(24), condition: z.enum(["RESELLABLE", "DAMAGED"]) })).max(100),
  submissionKey: z.string().min(16).max(64),
});

function parse<T extends z.ZodType>(schema: T, fd: FormData) {
  try {
    const r = schema.safeParse(JSON.parse(formString(fd, "payloadJson") || "{}"));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

// ───────────── Ask for a return or cancellation (completes at once if the person may approve) ─────────────

export async function requestReversal(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guarded("returns.create", async (user) => {
    const p = parse(requestSchema, fd);
    if (!p) return fail("The form could not be read. Reload the page and try again.");
    const currency = await getCurrency();

    const sale = await db.sale.findUnique({ where: { id: p.saleId }, select: { id: true, saleNo: true, salespersonId: true } });
    if (!sale || (!can(user, "sales.view_all") && sale.salespersonId !== user.id)) return fail("This sale was not found.");
    const approveNow = can(user, "returns.approve");

    try {
      const out = await db.$transaction(
        async (tx) => {
          const req = await createReversalRequest(tx, { user, ...p });
          const base = { user, entityType: "SaleReversal", entityId: req.id, reference: `${req.reversalNo} · ${sale.saleNo}` };
          if (!approveNow) {
            await writeAudit(tx, { ...base, action: p.kind === "CANCEL" ? "sale.cancel_requested" : "sale.return_requested", reason: p.reason });
            await notifyPermission(tx, "returns.approve", { type: "reversal.requested", title: `${p.kind === "CANCEL" ? "Cancellation" : "Return"} request for ${sale.saleNo}`, body: `${user.name}: ${p.reason}`, link: "/approvals" }, user.id);
            return { id: req.id, done: false };
          }
          const r = await completeReversal(tx, { reversalId: req.id, approver: user, dp: currency.decimals });
          await writeAudit(tx, { ...base, action: r.saleCancelled ? "sale.cancelled" : "sale.return_completed", reason: p.reason, after: { returnValue: r.returnValue, refund: r.refund, method: p.refundMethod } });
          return { id: req.id, done: true };
        },
        { timeout: 30000, maxWait: 15000 },
      );
      revalidatePath("/sales");
      revalidatePath(`/sales/${p.saleId}`);
      revalidatePath("/credit");
      revalidatePath("/inventory", "layout");
      revalidatePath("/approvals");
      return { ok: true, message: out.done ? "done" : "pending" };
    } catch (e) {
      if (e instanceof ReversalError) return fail(e.message, e.fieldErrors);
      const existing = await db.saleReversal.findUnique({ where: { submissionKey: p.submissionKey }, select: { status: true } });
      if (existing) return { ok: true, message: existing.status === "COMPLETED" ? "done" : "pending" };
      throw e;
    }
  });
  if (result.ok) {
    const saleId = parse(requestSchema, fd)?.saleId ?? "";
    redirect(`/sales/${saleId}?reversal=${result.message}`);
  }
  return result;
}

// ───────────── Approve or reject a waiting request ─────────────

export async function decideReversal(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return guarded("returns.approve", async (user) => {
    const reversalId = formString(fd, "reversalId");
    const decision = formString(fd, "decision") === "reject" ? "reject" : "approve";
    const note = formString(fd, "note");
    const currency = await getCurrency();

    try {
      await db.$transaction(
        async (tx) => {
          if (decision === "reject") {
            const r = await rejectReversal(tx, { reversalId, approver: user, note });
            await writeAudit(tx, { user, action: "sale.return_rejected", entityType: "SaleReversal", entityId: reversalId, reference: `${r.reversal.reversalNo} · ${r.saleNo}`, reason: note });
            await notifyUser(tx, r.requestedById, { type: "reversal.rejected", title: `Request for ${r.saleNo} was rejected`, body: note, link: "/sales" });
            return;
          }
          const r = await completeReversal(tx, { reversalId, approver: user, note: note || null, dp: currency.decimals });
          await writeAudit(tx, { user, action: r.saleCancelled ? "sale.cancelled" : "sale.return_completed", entityType: "SaleReversal", entityId: reversalId, reference: `${r.reversal.reversalNo} · ${r.saleNo}`, reason: note || r.reversal.reason, after: { returnValue: r.returnValue, refund: r.refund } });
          await notifyUser(tx, r.requestedById, { type: "reversal.approved", title: `Request for ${r.saleNo} was approved`, body: r.refund.gt(0) ? `Refund to give the customer: ${r.refund.toString()}` : undefined, link: "/sales" });
        },
        { timeout: 30000, maxWait: 15000 },
      );
    } catch (e) {
      if (e instanceof ReversalError) return fail(e.message, e.fieldErrors);
      throw e;
    }
    revalidatePath("/approvals");
    revalidatePath("/sales");
    revalidatePath("/credit");
    revalidatePath("/inventory", "layout");
    return { ok: true, message: decision === "reject" ? "Request rejected." : "Approved and completed." };
  });
}

// ───────────── Notifications ─────────────

export async function markNotificationsRead(): Promise<void> {
  const { getSessionUser } = await import("@/lib/auth/session");
  const user = await getSessionUser();
  if (!user) return;
  await db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/", "layout");
}
