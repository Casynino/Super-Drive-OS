"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/auth/can";
import { fail, formString, formValues, guarded, isUniqueViolation, type ActionState } from "@/lib/action";
import { notifyStockCrossings } from "@/lib/inventory/alerts";
import { InsufficientStockError } from "@/lib/inventory/engine";
import { formatMoney } from "@/lib/money";
import { notifyPermission } from "@/lib/notifications";
import { ResellerError, createReseller, issueStock, reportSold, returnStock, setResellerStatus, updateReseller } from "@/lib/resellers/engine";
import { SaleError } from "@/lib/sales/post-sale";
import { getCurrency } from "@/lib/settings";

const profileKeys = ["name", "businessName", "phone", "altPhone", "address", "salesLocation", "idInfo", "notes", "settlementDays"] as const;
const profile = (fd: FormData) => Object.fromEntries(profileKeys.map((k) => [k, formString(fd, k)])) as Record<(typeof profileKeys)[number], string>;

const linesSchema = z.array(z.object({ productId: z.string().min(1), unitId: z.string().min(1), quantity: z.string().max(24), totalCost: z.string().max(24).optional() })).max(100);
function readLines(fd: FormData, field: string) {
  try {
    const r = linesSchema.safeParse(JSON.parse(formString(fd, field) || "[]"));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

const refresh = (id?: string) => {
  revalidatePath("/resellers");
  if (id) revalidatePath(`/resellers/${id}`);
  revalidatePath("/inventory", "layout");
  revalidatePath("/dashboard");
  revalidatePath("/credit");
};

/** A message a person can act on, for the stock engine's "not enough" error. */
async function stockMessage(e: InsufficientStockError, where: string) {
  const p = await db.product.findUnique({ where: { id: e.productId }, select: { name: true } });
  return `There is only ${e.available.toString()} of ${p?.name ?? "this product"} ${where}, not ${e.requested.toString()}.`;
}

// ───────────── Register / edit ─────────────

export async function createResellerAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  const result = await guarded("resellers.manage", async (user) => {
    try {
      const r = await db.$transaction(async (tx) => {
        const created = await createReseller(tx, { user, ...profile(fd) });
        await writeAudit(tx, { user, action: "reseller.create", entityType: "Reseller", entityId: created.id, reference: created.name, after: { phone: created.phone, businessName: created.businessName } });
        return created;
      });
      refresh();
      return { ok: true, message: r.id };
    } catch (e) {
      if (e instanceof ResellerError) return fail(e.message, e.fieldErrors, values);
      throw e;
    }
  });
  if (result.ok && result.message) redirect(`/resellers/${result.message}?created=1`);
  return result;
}

/**
 * Registers a Winga from the till (Nino 2026-11-08: "we can add Winga there too"). It is the same record the Winga page
 * makes (account + custody location, credit limit 0, 14 days to settle); name, phone and ID number are required (business name and where they sell are asked too). Shop-floor right
 * `resellers.operate` (the Winga page keeps `resellers.manage` for editing and switching off).
 */
export async function quickCreateWinga(input: { name: string; phone: string; idInfo: string; businessName?: string; place?: string }): Promise<{ ok: true; customer: { id: string; name: string; phone: string | null; type: string } } | { ok: false; error: string }> {
  const out: { customer?: { id: string; name: string; phone: string | null; type: string } } = {};
  const result = await guarded("resellers.operate", async (user) => {
    const name = (input.name ?? "").trim();
    const phone = (input.phone ?? "").trim();
    const idInfo = (input.idInfo ?? "").trim();
    if (idInfo.length < 4) return fail("Enter the Winga's ID number. We keep it on their record.");
    if (await db.reseller.findFirst({ where: { phone }, select: { id: true } })) return fail("A Winga with this phone number is already registered. Search for them instead.");
    try {
      const r = await db.$transaction(async (tx) => {
        const created = await createReseller(tx, { user, name, businessName: (input.businessName ?? "").trim(), phone, altPhone: "", address: "", salesLocation: (input.place ?? "").trim(), idInfo, notes: "", settlementDays: "3" });
        await writeAudit(tx, { user, action: "reseller.create", entityType: "Reseller", entityId: created.id, reference: created.name, after: { phone: created.phone, source: "POS quick add" } });
        return tx.customer.findUniqueOrThrow({ where: { id: created.customerId }, select: { id: true, name: true, phone: true, type: true } });
      });
      refresh();
      out.customer = r;
      return { ok: true };
    } catch (e) {
      if (e instanceof ResellerError) return fail(Object.values(e.fieldErrors)[0] ?? e.message);
      throw e;
    }
  });
  if (result.error || !out.customer) return { ok: false, error: result.error ?? "Could not add the Winga." };
  return { ok: true, customer: out.customer };
}

export async function updateResellerAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  const result = await guarded("resellers.manage", async (user) => {
    const id = formString(fd, "id");
    try {
      await db.$transaction(async (tx) => {
        const r = await updateReseller(tx, { id, ...profile(fd) });
        await writeAudit(tx, { user, action: "reseller.update", entityType: "Reseller", entityId: id, reference: r.name });
      });
      refresh(id);
      return { ok: true, message: id };
    } catch (e) {
      if (e instanceof ResellerError) return fail(e.message, e.fieldErrors, values);
      throw e;
    }
  });
  if (result.ok && result.message) redirect(`/resellers/${result.message}?saved=1`);
  return result;
}

export async function setResellerStatusAction(fd: FormData) {
  await guarded("resellers.manage", async (user) => {
    const id = formString(fd, "id");
    const status = formString(fd, "status") === "INACTIVE" ? "INACTIVE" : "ACTIVE";
    await db.$transaction(async (tx) => {
      const r = await setResellerStatus(tx, id, status);
      await writeAudit(tx, { user, action: status === "ACTIVE" ? "reseller.reactivate" : "reseller.deactivate", entityType: "Reseller", entityId: id, reference: r.name });
    });
    refresh(id);
    return { ok: true };
  });
}

// ───────────── Issue stock ─────────────

export async function issueStockAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  const resellerId = formString(fd, "resellerId");
  const result = await guarded("resellers.operate", async (user) => {
    const lines = readLines(fd, "linesJson");
    const submissionKey = formString(fd, "submissionKey");
    if (!lines || submissionKey.length < 16) return fail("The form could not be read. Reload the page and try again.", undefined, values);
    const currency = await getCurrency();
    try {
      const out = await db.$transaction(
        async (tx) => {
          const r = await issueStock(tx, { user, resellerId, fromLocationId: formString(fd, "fromLocationId"), lines, notes: formString(fd, "notes") || null, submissionKey, currencyDecimals: currency.decimals });
          await writeAudit(tx, { user, action: "reseller.issue", entityType: "ResellerIssue", entityId: r.issue.id, reference: `${r.issue.issueNo} · ${r.reseller.name}`, after: { expectedValue: r.issue.expectedValue.toString(), lines: lines.length } });
          await notifyPermission(tx, "resellers.manage", { type: "reseller.issue", title: `Stock issued to ${r.reseller.name}: ${formatMoney(r.issue.expectedValue, currency)}`, body: `${user.name} · ${r.issue.issueNo}`, link: `/resellers/issues/${r.issue.id}` }, user.id);
          const items = await tx.resellerIssueItem.findMany({ where: { issueId: r.issue.id }, select: { productId: true, quantity: true } });
          await notifyStockCrossings(tx, items.map((i) => ({ productId: i.productId, qty: i.quantity })), `After issuing stock to ${r.reseller.name} (${r.issue.issueNo})`);
          return r.issue.id;
        },
        { timeout: 30000, maxWait: 15000 },
      );
      refresh(resellerId);
      return { ok: true, message: out };
    } catch (e) {
      if (e instanceof ResellerError) return fail(e.message, e.fieldErrors, values);
      if (e instanceof InsufficientStockError) return fail(await stockMessage(e, "on the shelf"), undefined, values);
      if (isUniqueViolation(e)) {
        const existing = await db.resellerIssue.findUnique({ where: { submissionKey }, select: { id: true } });
        if (existing) return { ok: true, message: existing.id };
      }
      throw e;
    }
  });
  if (result.ok && result.message) redirect(`/resellers/issues/${result.message}?done=1`);
  return result;
}

// ───────────── What the reseller sold ─────────────

export async function reportSoldAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  const resellerId = formString(fd, "resellerId");
  const result = await guarded("resellers.operate", async (user) => {
    const lines = readLines(fd, "linesJson");
    const submissionKey = formString(fd, "submissionKey");
    if (!lines || submissionKey.length < 16) return fail("The form could not be read. Reload the page and try again.", undefined, values);
    const currency = await getCurrency();
    const canDiscount = can(user, "sales.discount");
    try {
      const out = await db.$transaction(
        async (tx) => {
          const r = await reportSold(tx, {
            user, canDiscount, resellerId, notes: formString(fd, "notes") || null, discountReason: formString(fd, "discountReason") || null, submissionKey, currencyDecimals: currency.decimals,
            lines: lines.map((l) => ({ productId: l.productId, unitId: l.unitId, quantity: l.quantity, unitPrice: canDiscount ? (l.totalCost ?? "").trim() : "" })),
          });
          await writeAudit(tx, { user, action: "reseller.sold_report", entityType: "Sale", entityId: r.sale.id, reference: `${r.sale.saleNo} · ${r.reseller.name}`, after: { total: r.sale.total.toString(), discount: r.sale.discountTotal.toString() } });
          await notifyPermission(tx, "resellers.manage", { type: "reseller.sold_report", title: `${r.reseller.name} sold ${formatMoney(r.sale.total, currency)}`, body: `${user.name} recorded ${r.sale.saleNo}. The winga now owes this amount.`, link: `/resellers/${resellerId}` }, user.id);
          return r.sale.saleNo;
        },
        { timeout: 30000, maxWait: 15000 },
      );
      refresh(resellerId);
      return { ok: true, message: out };
    } catch (e) {
      if (e instanceof ResellerError) return fail(e.message, e.fieldErrors, values);
      if (e instanceof SaleError) return fail(e.message, e.fieldErrors, values);
      if (e instanceof InsufficientStockError) return fail(await stockMessage(e, "with this winga"), undefined, values);
      if (isUniqueViolation(e)) {
        const existing = await db.sale.findUnique({ where: { submissionKey }, select: { saleNo: true } });
        if (existing) return { ok: true, message: existing.saleNo };
      }
      throw e;
    }
  });
  if (result.ok && result.message) redirect(`/resellers/${resellerId}?reported=${encodeURIComponent(result.message)}`);
  return result;
}

// ───────────── Returns ─────────────

export async function returnStockAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  const resellerId = formString(fd, "resellerId");
  const result = await guarded("resellers.operate", async (user) => {
    const good = readLines(fd, "goodJson");
    const bad = readLines(fd, "damagedJson");
    const submissionKey = formString(fd, "submissionKey");
    if (!good || !bad || submissionKey.length < 16) return fail("The form could not be read. Reload the page and try again.", undefined, values);
    try {
      const out = await db.$transaction(
        async (tx) => {
          const r = await returnStock(tx, {
            user, resellerId, toLocationId: formString(fd, "toLocationId"), notes: formString(fd, "notes") || null, submissionKey,
            lines: [...good.map((l) => ({ ...l, condition: "RESELLABLE" as const })), ...bad.map((l) => ({ ...l, condition: "DAMAGED" as const }))],
          });
          await writeAudit(tx, { user, action: "reseller.return", entityType: "ResellerReturn", entityId: r.ret.id, reference: `${r.ret.returnNo} · ${r.reseller.name}`, after: { good: good.length, damaged: bad.length } });
          await notifyPermission(tx, "resellers.manage", { type: "reseller.return", title: `${r.reseller.name} returned stock`, body: `${user.name} · ${r.ret.returnNo}${bad.length ? " (some damaged)" : ""}`, link: `/resellers/${resellerId}` }, user.id);
          return r.ret.returnNo;
        },
        { timeout: 30000, maxWait: 15000 },
      );
      refresh(resellerId);
      return { ok: true, message: out };
    } catch (e) {
      if (e instanceof ResellerError) return fail(e.message, e.fieldErrors, values);
      if (e instanceof InsufficientStockError) return fail(await stockMessage(e, "with this winga"), undefined, values);
      if (isUniqueViolation(e)) {
        const existing = await db.resellerReturn.findUnique({ where: { submissionKey }, select: { returnNo: true } });
        if (existing) return { ok: true, message: existing.returnNo };
      }
      throw e;
    }
  });
  if (result.ok && result.message) redirect(`/resellers/${resellerId}?returned=${encodeURIComponent(result.message)}`);
  return result;
}
