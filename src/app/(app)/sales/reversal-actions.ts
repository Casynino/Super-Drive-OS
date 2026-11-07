"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/auth/can";
import { fail, formString, guarded, type ActionState } from "@/lib/action";
import { notifyPermission, notifyUser } from "@/lib/notifications";
import { ReversalError, completeReversal, createReversalRequest, rejectReversal, returnedBySaleItem } from "@/lib/sales/reversals";
import { getCurrency, getReturnsNeedApproval } from "@/lib/settings";

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
    // Returns happen at once (Nino 2026-11-08): the reason is mandatory, the owner is told. Unless the owner switched approval on.
    const approveNow = can(user, "returns.approve") || !(await getReturnsNeedApproval());
    const byOwner = can(user, "returns.approve");

    try {
      const out = await db.$transaction(
        async (tx) => {
          const req = await createReversalRequest(tx, { user, ...p });
          const base = { user, entityType: "SaleReversal", entityId: req.id, reference: `${req.reversalNo} · ${sale.saleNo}` };
          if (!approveNow) {
            await writeAudit(tx, { ...base, action: p.kind === "CANCEL" ? "sale.cancel_requested" : "sale.return_requested", reason: p.reason });
            await notifyPermission(tx, "returns.approve", { type: "reversal.requested", title: `${p.kind === "CANCEL" ? "Cancellation" : "Return"} request for ${sale.saleNo}`, body: `${user.name}: ${p.reason}`, link: `/sales/${sale.id}` }, user.id);
            return { id: req.id, done: false };
          }
          const r = await completeReversal(tx, { reversalId: req.id, approver: user, dp: currency.decimals });
          await writeAudit(tx, { ...base, action: r.saleCancelled ? "sale.cancelled" : "sale.return_completed", reason: p.reason, after: { returnValue: r.returnValue, refund: r.refund, method: p.refundMethod } });
          // the boss sees every return, with the reason and what went back to the customer
          if (!byOwner) {
            await notifyPermission(tx, "returns.approve", { type: "reversal.done", title: `${r.saleCancelled ? "Sale cancelled" : "Goods returned"}: ${sale.saleNo}`, body: `${user.name}: ${p.reason}${r.refund.gt(0) ? ` · refunded ${r.refund.toString()}` : ""}`, link: `/sales/${sale.id}` }, user.id);
          }
          // goods that came back damaged: the warehouse and the boss are told, they are under investigation
          const damaged = p.kind === "RETURN" ? p.lines.filter((l) => l.condition === "DAMAGED") : [];
          if (damaged.length > 0) {
            const note = { type: "return.damaged", title: `Damaged goods returned: ${sale.saleNo}`, body: `${user.name}: ${p.reason}. The goods are under investigation.`, link: "/warehouse/discrepancies" };
            await notifyPermission(tx, "warehouse.operate", note, user.id); // the warehouse team and the owners (an owner passes every permission)
          }
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

// ───────────── A Winga brings back what they did not sell ─────────────

/**
 * One click: all the goods still on the Winga's invoice go back to the store and the invoice shrinks by their value
 * (Nino 2026-11-08: "when the Winga comes back and did not sell, we just click Return and the goods go back to the store").
 * It completes at once, without the owner's approval, because no money moves: if the Winga already paid part of the invoice a
 * refund would be needed, and then it is refused here and goes through the normal Return / cancel on the invoice page.
 * Always audited; the owners get a notification.
 */
export async function returnWingaGoods(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const saleId = formString(fd, "saleId");
  const key = formString(fd, "submissionKey");
  const result = await guarded("returns.create", async (user) => {
    if (!saleId || key.length < 16) return fail("The form could not be read. Reload the page and try again.");
    const sale = await db.sale.findUnique({ where: { id: saleId }, select: { id: true, saleNo: true, customerId: true, customer: { select: { name: true, reseller: { select: { id: true } } } }, items: { select: { id: true, enteredQty: true } } } });
    if (!sale || !sale.customer?.reseller) return fail("This invoice does not belong to a Winga.");
    const currency = await getCurrency();
    try {
      await db.$transaction(
        async (tx) => {
          const done = await returnedBySaleItem(tx, sale.id, true);
          const lines = sale.items
            .map((it) => ({ id: it.id, left: it.enteredQty.minus(done.qty.get(it.id) ?? 0) }))
            .filter((x) => x.left.gt(0))
            .map((x) => ({ saleItemId: x.id, quantity: x.left.toString(), condition: "RESELLABLE" as const }));
          if (lines.length === 0) throw new ReversalError("All the goods on this invoice were already returned.");
          const req = await createReversalRequest(tx, { user, saleId: sale.id, kind: "RETURN", reason: "Winga returned the goods he did not sell", refundMethod: null, refundReference: null, lines, submissionKey: key });
          const r = await completeReversal(tx, { reversalId: req.id, approver: user, dp: currency.decimals });
          await writeAudit(tx, { user, action: "winga.goods_returned", entityType: "SaleReversal", entityId: req.id, reference: `${req.reversalNo} · ${sale.saleNo}`, reason: "Winga returned the goods he did not sell", after: { winga: sale.customer!.name, returnValue: r.returnValue, refund: r.refund } });
          await notifyPermission(tx, "returns.approve", { type: "reversal.winga", title: `${sale.customer!.name} returned goods (${sale.saleNo})`, body: `${user.name} took the goods back to the store. Value ${r.returnValue.toString()}.`, link: `/sales/${sale.id}` }, user.id);
        },
        { timeout: 30000, maxWait: 15000 },
      );
    } catch (e) {
      if (e instanceof ReversalError) {
        if (e.fieldErrors.refundMethod) return fail("This Winga already paid part of this invoice, so some money would have to go back. Use Return / cancel on the invoice page for this one.");
        return fail(e.message);
      }
      const existing = await db.saleReversal.findUnique({ where: { submissionKey: key }, select: { status: true } });
      if (existing?.status === "COMPLETED") return { ok: true, message: sale.saleNo };
      throw e;
    }
    revalidatePath("/sales");
    revalidatePath(`/sales/${sale.id}`);
    revalidatePath("/credit");
    revalidatePath("/customers");
    revalidatePath("/inventory", "layout");
    revalidatePath("/warehouse", "layout");
    return { ok: true, message: sale.saleNo };
  });
  if (result.ok) {
    const customerId = formString(fd, "customerId");
    redirect(`/customers/${customerId}/return?done=${encodeURIComponent(result.message ?? "")}`);
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
