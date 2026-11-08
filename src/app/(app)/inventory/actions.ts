"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { AdjustmentKind } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/auth/can";
import { fail, formString, formValues, guarded, guardedAny, isUniqueViolation, type ActionState } from "@/lib/action";
import { notifyPermission } from "@/lib/notifications";
import { parseMoney } from "@/lib/money";
import { getCurrency } from "@/lib/settings";
import { InsufficientStockError, type Dec } from "@/lib/inventory/engine";
import { postAdjustment, postReceipt, postTransfer, type ReceiptLine } from "@/lib/inventory/documents";
import { resolveLines, type RawLine, type ResolveResult } from "@/lib/inventory/lines";
import type { PermissionKey } from "@/lib/permissions";
import { todayInBusinessTz } from "./data";

/** Thrown inside a transaction to roll it back and hand a form error to the user. */
class FormError extends Error {
  constructor(public state: ActionState) {
    super("form error");
  }
}

const keySchema = z.string().min(16, "Please reload the page and try again.").max(64);

const rawLinesSchema = z
  .array(z.object({ productId: z.string().min(1), unitId: z.string().min(1), quantity: z.string().max(24), totalCost: z.string().max(24).optional() }))
  .max(200);

function readRawLines(fd: FormData): RawLine[] | null {
  try {
    const parsed = rawLinesSchema.safeParse(JSON.parse(formString(fd, "linesJson") || "[]"));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function lineFieldErrors(errors: Record<number, string>) {
  return Object.fromEntries(Object.entries(errors).map(([i, msg]) => [`line.${i}`, msg]));
}

function unwrapResolve(r: ResolveResult, values: Record<string, string>) {
  if (r.ok) return r.lines;
  throw new FormError(fail(r.message, { ...lineFieldErrors(r.errors), ...(Object.keys(r.errors).length ? {} : { lines: r.message }) }, values));
}

async function insufficientMessage(e: InsufficientStockError) {
  const [p, loc] = await Promise.all([
    db.product.findUnique({ where: { id: e.productId }, include: { baseUnit: true } }),
    db.location.findUnique({ where: { id: e.locationId } }),
  ]);
  return `Not enough stock of ${p?.name ?? "this product"} at ${loc?.name ?? "this location"}: ${e.available.toString()} ${p?.baseUnit.symbol ?? ""} available, ${e.requested.toString()} needed.`;
}

const headErrors = (issues: z.core.$ZodIssue[]) => {
  const out: Record<string, string> = {};
  for (const i of issues) out[String(i.path[0])] ??= i.message;
  return out;
};

async function activeLocation(id: string) {
  return db.location.findFirst({ where: { id, status: "ACTIVE" } });
}

// ───────────── Receiving ─────────────

export async function createReceipt(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  const result = await guarded("inventory.receive", async (user) => {
    const currency = await getCurrency();
    const canCost = can(user, "products.cost");
    const type = formString(fd, "type") === "OPENING_STOCK" ? "OPENING_STOCK" : "PURCHASE";

    const head = z
      .object({
        locationId: z.string().min(1, "Choose where the stock is received."),
        supplierId: z.string().optional(),
        supplierInvoice: z.string().trim().max(60, "Too long.").optional(),
        receivedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date received."),
        notes: z.string().trim().max(500, "Too long.").optional(),
        submissionKey: keySchema,
      })
      .safeParse({
        locationId: formString(fd, "locationId"),
        supplierId: formString(fd, "supplierId") || undefined,
        supplierInvoice: formString(fd, "supplierInvoice") || undefined,
        receivedDate: formString(fd, "receivedDate"),
        notes: formString(fd, "notes") || undefined,
        submissionKey: formString(fd, "submissionKey"),
      });
    if (!head.success) return fail("Please fix the highlighted fields.", headErrors(head.error.issues), values);
    const h = head.data;
    if (h.receivedDate > todayInBusinessTz()) return fail("Please fix the highlighted fields.", { receivedDate: "The date cannot be in the future." }, values);

    const raw = readRawLines(fd);
    if (!raw) return fail("The product list could not be read. Reload the page and try again.", undefined, values);
    if (!(await activeLocation(h.locationId))) return fail("Please fix the highlighted fields.", { locationId: "Choose an active location." }, values);
    const supplierId = type === "PURCHASE" ? (h.supplierId ?? null) : null;
    if (supplierId && !(await db.supplier.findFirst({ where: { id: supplierId, status: "ACTIVE" } }))) {
      return fail("Please fix the highlighted fields.", { supplierId: "Choose an active supplier." }, values);
    }

    try {
      const receipt = await db.$transaction(async (tx) => {
        const resolved = unwrapResolve(await resolveLines(tx, raw), values);

        const costErrors: Record<string, string> = {};
        const lines: ReceiptLine[] = [];
        for (const l of resolved) {
          let lineTotal: Dec;
          if (canCost) {
            const parsed = parseMoney(raw[l.index]!.totalCost ?? "", currency.decimals);
            if (!parsed || parsed.lte(0)) {
              costErrors[`line.${l.index}`] = currency.decimals === 0 ? "Enter the total cost as a whole amount." : "Enter the total cost.";
              continue;
            }
            lineTotal = parsed;
          } else {
            // Without permission to enter costs, stock comes in at the product's default purchase price.
            if (l.purchasePrice.lte(0)) {
              costErrors[`line.${l.index}`] = `No purchase price is set for ${l.productName}. Ask someone who manages costs to set it first.`;
              continue;
            }
            lineTotal = l.purchasePrice.mul(l.quantity).toDecimalPlaces(2);
          }
          lines.push({ ...l, lineTotal });
        }
        if (Object.keys(costErrors).length) throw new FormError(fail("Please fix the highlighted lines.", costErrors, values));

        const posted = await postReceipt(tx, {
          type,
          supplierId,
          locationId: h.locationId,
          supplierInvoice: h.supplierInvoice ?? null,
          receivedDate: new Date(`${h.receivedDate}T00:00:00.000Z`),
          notes: h.notes ?? null,
          submissionKey: h.submissionKey,
          lines,
          user,
        });
        await writeAudit(tx, {
          user,
          action: "stock.receive",
          entityType: "StockReceipt",
          entityId: posted.id,
          reference: posted.receiptNo,
          after: { type, locationId: h.locationId, supplierId, totalCost: posted.totalCost, lines: lines.map((l) => ({ product: l.productName, entered: `${l.enteredQty} (unit ${l.enteredUnitId})`, baseQty: l.quantity, lineTotal: l.lineTotal })) },
        });
        return posted;
      });
      revalidatePath("/inventory", "layout");
      return { ok: true, message: receipt.id };
    } catch (e) {
      if (e instanceof FormError) return e.state;
      const existing = await db.stockReceipt.findUnique({ where: { submissionKey: h.submissionKey }, select: { id: true } });
      if (existing) return { ok: true, message: existing.id }; // double-click: already saved, show it
      throw e;
    }
  });
  if (result.ok && result.message) redirect(`/inventory/receiving/${result.message}?created=1`);
  return result;
}

// ───────────── Transfers ─────────────

export async function createTransfer(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  const result = await guarded("inventory.transfer", async (user) => {
    const head = z
      .object({
        fromLocationId: z.string().min(1, "Choose the source location."),
        toLocationId: z.string().min(1, "Choose the destination."),
        notes: z.string().trim().max(500, "Too long.").optional(),
        submissionKey: keySchema,
      })
      .safeParse({
        fromLocationId: formString(fd, "fromLocationId"),
        toLocationId: formString(fd, "toLocationId"),
        notes: formString(fd, "notes") || undefined,
        submissionKey: formString(fd, "submissionKey"),
      });
    if (!head.success) return fail("Please fix the highlighted fields.", headErrors(head.error.issues), values);
    const h = head.data;
    if (h.fromLocationId === h.toLocationId) return fail("Please fix the highlighted fields.", { toLocationId: "Choose a different destination." }, values);
    const raw = readRawLines(fd);
    if (!raw) return fail("The product list could not be read. Reload the page and try again.", undefined, values);
    const [from, to] = await Promise.all([activeLocation(h.fromLocationId), activeLocation(h.toLocationId)]);
    if (!from) return fail("Please fix the highlighted fields.", { fromLocationId: "Choose an active location." }, values);
    if (!to) return fail("Please fix the highlighted fields.", { toLocationId: "Choose an active location." }, values);

    try {
      const transfer = await db.$transaction(async (tx) => {
        const lines = unwrapResolve(await resolveLines(tx, raw), values);
        const posted = await postTransfer(tx, { fromLocationId: from.id, toLocationId: to.id, notes: h.notes ?? null, submissionKey: h.submissionKey, lines, user });
        await writeAudit(tx, {
          user,
          action: "stock.transfer",
          entityType: "StockTransfer",
          entityId: posted.id,
          reference: posted.transferNo,
          after: { from: from.name, to: to.name, lines: lines.map((l) => ({ product: l.productName, baseQty: l.quantity })) },
        });
        return posted;
      });
      revalidatePath("/inventory", "layout");
      return { ok: true, message: transfer.id };
    } catch (e) {
      if (e instanceof FormError) return e.state;
      if (e instanceof InsufficientStockError) return fail(await insufficientMessage(e), undefined, values);
      const existing = await db.stockTransfer.findUnique({ where: { submissionKey: h.submissionKey }, select: { id: true } });
      if (existing) return { ok: true, message: existing.id };
      throw e;
    }
  });
  if (result.ok && result.message) redirect(`/inventory/transfers/${result.message}?created=1`);
  return result;
}

// ───────────── Adjustments / damage / counts ─────────────

const KIND_PERMISSION: Record<AdjustmentKind, PermissionKey> = {
  DAMAGE: "inventory.report_damage",
  COUNT: "inventory.count",
  INCREASE: "inventory.adjust",
  DECREASE: "inventory.adjust",
};
const AUDIT_ACTION: Record<AdjustmentKind, string> = { DAMAGE: "stock.damage", COUNT: "stock.count", INCREASE: "stock.adjust_increase", DECREASE: "stock.adjust_decrease" };

export async function createAdjustment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  const kind = formString(fd, "kind") as AdjustmentKind;
  if (!(kind in KIND_PERMISSION)) return fail("Please fix the highlighted fields.", { kind: "Choose what you are recording." }, values);

  const result = await guarded(KIND_PERMISSION[kind], async (user) => {
    const head = z
      .object({
        locationId: z.string().min(1, "Choose the location."),
        reason: z.string().trim().min(5, "Give a reason (at least 5 characters).").max(300, "Too long."),
        submissionKey: keySchema,
      })
      .safeParse({ locationId: formString(fd, "locationId"), reason: formString(fd, "reason"), submissionKey: formString(fd, "submissionKey") });
    if (!head.success) return fail("Please fix the highlighted fields.", headErrors(head.error.issues), values);
    const h = head.data;
    const raw = readRawLines(fd);
    if (!raw) return fail("The product list could not be read. Reload the page and try again.", undefined, values);
    const location = await activeLocation(h.locationId);
    if (!location) return fail("Please fix the highlighted fields.", { locationId: "Choose an active location." }, values);

    try {
      const doc = await db.$transaction(async (tx) => {
        const lines = unwrapResolve(await resolveLines(tx, raw, { allowZero: kind === "COUNT" }), values);
        const { adjustment, applied } = await postAdjustment(tx, { kind, locationId: location.id, reason: h.reason, submissionKey: h.submissionKey, lines, user });
        await writeAudit(tx, {
          user,
          action: AUDIT_ACTION[kind],
          entityType: "StockAdjustment",
          entityId: adjustment.id,
          reference: adjustment.adjustmentNo,
          reason: h.reason,
          after: { location: location.name, linesChanged: applied, lines: lines.map((l) => ({ product: l.productName, baseQty: l.quantity })) },
        });
        return adjustment;
      });
      revalidatePath("/inventory", "layout");
      return { ok: true, message: doc.id };
    } catch (e) {
      if (e instanceof FormError) return e.state;
      if (e instanceof InsufficientStockError) return fail(await insufficientMessage(e), undefined, values);
      const existing = await db.stockAdjustment.findUnique({ where: { submissionKey: h.submissionKey }, select: { id: true } });
      if (existing) return { ok: true, message: existing.id };
      throw e;
    }
  });
  if (result.ok && result.message) redirect(`/inventory/adjustments/${result.message}?created=1`);
  return result;
}


// ───────────── Add or remove stock by hand, from a product (Nino 2026-11-08) ─────────────
// For stock that comes without a purchase order ("from the boss in China") and for taking stock out. It is a normal INCREASE / DECREASE adjustment
// (numbered document, ledger rows, item history), at the default warehouse, always with a note; the owners are told.

const stockChangeSchema = z.object({
  productId: z.string().min(1),
  mode: z.enum(["ADD", "REMOVE", "COUNT"]),
  quantity: z.string().min(1).max(24),
  note: z.string().trim().min(5, "Say where it came from or why, in a few words.").max(300),
  submissionKey: keySchema,
});

export async function adjustStockAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return guardedAny(["inventory.adjust", "inventory.count"], async (user) => {
    const parsed = stockChangeSchema.safeParse({ productId: formString(fd, "productId"), mode: formString(fd, "mode"), quantity: formString(fd, "quantity"), note: formString(fd, "note"), submissionKey: formString(fd, "submissionKey") });
    if (!parsed.success) return fail(parsed.error.issues[0]?.path[0] === "note" ? parsed.error.issues[0].message : "Enter how many, and a short note.", headErrors(parsed.error.issues));
    const p = parsed.data;
    // adding and removing need the adjust right; setting a counted quantity needs the count right or the adjust right (checked here, never only in the screen)
    // (the Director does not hold the shop-floor count right, but may already set any quantity with the adjust right, so setting the counted number is allowed for him too)
    if (p.mode === "COUNT" ? !can(user, "inventory.count") && !can(user, "inventory.adjust") : !can(user, "inventory.adjust")) return fail("You do not have permission to do this.");
    const qty = Number(p.quantity);
    if (!Number.isFinite(qty) || (p.mode === "COUNT" ? qty < 0 : qty <= 0)) return fail("Enter how many.", { quantity: p.mode === "COUNT" ? "Enter the counted number." : "Enter a number above zero." });
    const location = await db.location.findFirst({ where: { isDefault: true, status: "ACTIVE" }, select: { id: true, name: true } });
    if (!location) return fail("No warehouse is set up.");
    const kind: AdjustmentKind = p.mode === "ADD" ? "INCREASE" : p.mode === "REMOVE" ? "DECREASE" : "COUNT";
    const reason = `${p.mode === "ADD" ? "Added by hand (no purchase order)" : p.mode === "REMOVE" ? "Removed by hand" : "Counted by hand"}: ${p.note}`;
    try {
      const out = await db.$transaction(async (tx) => {
        const product = await tx.product.findUnique({ where: { id: p.productId }, select: { name: true, baseUnitId: true, status: true } });
        if (!product || product.status !== "ACTIVE") throw new FormError(fail("This product is not available."));
        const lines = unwrapResolve(await resolveLines(tx, [{ productId: p.productId, unitId: product.baseUnitId, quantity: p.quantity }], { allowZero: p.mode === "COUNT" }), {});
        const { adjustment } = await postAdjustment(tx, { kind, locationId: location.id, reason, submissionKey: `hand:${p.submissionKey}`, lines, user });
        await writeAudit(tx, {
          user,
          action: AUDIT_ACTION[kind],
          entityType: "StockAdjustment",
          entityId: adjustment.id,
          reference: adjustment.adjustmentNo,
          reason,
          after: { location: location.name, lines: [{ product: product.name, baseQty: p.quantity }] },
        });
        await notifyPermission(tx, "inventory.valuation", { type: p.mode === "ADD" ? "stock.added_by_hand" : p.mode === "REMOVE" ? "stock.removed_by_hand" : "stock.counted_by_hand", title: `${user.name} ${p.mode === "ADD" ? "added" : p.mode === "REMOVE" ? "removed" : "counted"} stock of ${product.name}`, body: `${p.quantity} ${p.mode === "ADD" ? "added without a purchase order" : p.mode === "REMOVE" ? "taken out" : "counted on the shelf"}. ${p.note}`, link: `/inventory/adjustments/${adjustment.id}` }, user.id);
        return adjustment;
      });
      revalidatePath("/inventory", "layout");
      revalidatePath("/products", "layout");
      revalidatePath("/warehouse", "layout");
      return { ok: true, message: out.adjustmentNo };
    } catch (e) {
      if (e instanceof FormError) return e.state;
      if (e instanceof InsufficientStockError) return fail(`Only ${e.available.toString()} pieces can be removed. The rest is reserved for customers waiting to collect.`, { quantity: `At most ${e.available.toString()} pieces.` });
      if (isUniqueViolation(e)) return { ok: true, message: "Already saved." };
      throw e;
    }
  });
}
