"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { fail, formString, guarded, isUniqueViolation, type ActionState } from "@/lib/action";
import type { ListNote } from "@/components/warehouse/ReleaseHost";
import { largestPack, qtyText } from "@/lib/qty";
import { AUTH_LABEL } from "@/lib/warehouse/labels";
import { PickupError, loadPickup, logScanRejected, markReady, parseScan, pickupBlock, releasePickup, startPreparing } from "@/lib/warehouse/pickup";

const D = Prisma.Decimal;
const refresh = () => {
  revalidatePath("/warehouse", "layout");
  revalidatePath("/inventory", "layout");
  revalidatePath("/sales");
};

/** The attendant opened the order and started picking the goods. */
export async function startPreparingAction(noteId: string): Promise<ActionState> {
  return guarded("warehouse.operate", async (user) => {
    try {
      const note = await db.$transaction(async (tx) => {
        const n = await startPreparing(tx, { noteId, userId: user.id });
        await writeAudit(tx, { user, action: "pickup.preparing", entityType: "PickupNote", entityId: noteId, reference: n.noteNo });
        return n;
      });
      refresh();
      return { ok: true, message: `${note.noteNo} is being prepared.` };
    } catch (e) {
      if (e instanceof PickupError) return fail(e.message);
      throw e;
    }
  });
}

/** The goods are picked and set aside, waiting to be collected. */
export async function markReadyAction(noteId: string): Promise<ActionState> {
  return guarded("warehouse.operate", async (user) => {
    try {
      const note = await db.$transaction(async (tx) => {
        const n = await markReady(tx, { noteId, userId: user.id });
        await writeAudit(tx, { user, action: "pickup.ready", entityType: "PickupNote", entityId: noteId, reference: n.noteNo });
        return n;
      });
      refresh();
      return { ok: true, message: `${note.noteNo} is ready for collection.` };
    } catch (e) {
      if (e instanceof PickupError) return fail(e.message);
      throw e;
    }
  });
}

const releaseSchema = z.object({
  noteId: z.string().min(1),
  submissionKey: z.string().min(16).max(64),
  collectedBy: z.string().trim().max(80).optional(),
  remark: z.string().trim().max(300).optional(),
  mode: z.enum(["all", "some"]),
});

/** CONFIRM GOODS RELEASED: stock leaves, the reservation ends, the attendant and the time are recorded. Everything in one transaction. */
export async function releaseAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return guarded("warehouse.operate", async (user) => {
    const parsed = releaseSchema.safeParse({ noteId: formString(fd, "noteId"), submissionKey: formString(fd, "submissionKey"), collectedBy: formString(fd, "collectedBy") || undefined, remark: formString(fd, "remark") || undefined, mode: formString(fd, "mode") || "all" });
    if (!parsed.success) return fail("The form could not be read. Reload the page and try again.");
    const v = parsed.data;
    if (fd.get("checked") !== "on") return fail("Tick the box to confirm you checked the goods against the list.", { checked: "Confirm you checked the goods." });

    let items: { noteItemId: string; quantity: Prisma.Decimal }[] | undefined;
    if (v.mode === "some") {
      items = [];
      for (const [k, raw] of fd.entries()) {
        if (!k.startsWith("qty.") || typeof raw !== "string" || raw.trim() === "") continue;
        const n = Number(raw.replace(/,/g, ""));
        if (!Number.isFinite(n) || n < 0 || n !== Math.floor(n)) return fail("Enter whole pieces for the quantity handed over.", { [k]: "Whole pieces only." });
        if (n > 0) items.push({ noteItemId: k.slice(4), quantity: new D(n) });
      }
      if (items.length === 0) return fail("Enter how many were handed over, or choose to release everything.");
    }

    try {
      const done = await db.$transaction(
        async (tx) => {
          const r = await releasePickup(tx, { noteId: v.noteId, userId: user.id, items, collectedBy: v.collectedBy, remark: v.remark, submissionKey: v.submissionKey });
          await writeAudit(tx, { user, action: "pickup.released", entityType: "PickupNote", entityId: v.noteId, reference: r.noteNo, after: { release: r.releaseNo, completed: r.completed, collectedBy: v.collectedBy ?? null } });
          return r;
        },
        { timeout: 30000, maxWait: 15000 },
      );
      refresh();
      return { ok: true, message: done.completed ? `${done.noteNo} is completed. The goods were released.` : `Partly released. ${done.left.toString()} still waiting on ${done.noteNo}.` };
    } catch (e) {
      if (e instanceof PickupError) {
        // a refused release is kept: who tried, which note, why
        if (e.code === "ALREADY_COLLECTED" || e.code === "CANCELLED" || e.code === "NOT_AUTHORIZED") await logScanRejected(db, { userId: user.id, noteId: v.noteId, code: e.code, detail: e.message });
        return fail(e.message);
      }
      // double click / retry of the same form: it was already saved
      if (isUniqueViolation(e)) {
        const existing = await db.pickupRelease.findUnique({ where: { submissionKey: v.submissionKey }, select: { releaseNo: true } });
        if (existing) return { ok: true, message: `Already saved as ${existing.releaseNo}.` };
      }
      throw e;
    }
  });
}

/** `note` is everything the release pop-up needs (null when the note cannot be released, `blocked` says why). */
export type ScanResult = { ok: true; noteId: string; noteNo: string; blocked: string | null; note: ListNote | null } | { ok: false; code: string; message: string };

/** The scanner (camera or typed) found something: look it up on the server. Refused scans are recorded. */
export async function scanAction(code: string): Promise<ScanResult> {
  const result = await guarded("warehouse.operate", async (user) => {
    const parsed = parseScan(String(code ?? ""));
    const note = parsed ? await loadPickup(db, parsed) : null;
    if (!note) {
      await logScanRejected(db, { userId: user.id, code: "INVALID", detail: `Unknown code "${String(code ?? "").slice(0, 40)}"` });
      return { ok: true, message: JSON.stringify({ ok: false, code: "INVALID", message: "This is not a Super Drive pickup note. Check the code and scan again." }) } as ActionState;
    }
    const block = pickupBlock(note);
    if (block) await logScanRejected(db, { userId: user.id, locationId: note.locationId, noteId: note.id, code: block.code, detail: block.message });
    const lines = note.items
      .map((i) => {
        const waiting = i.quantity.minus(i.releasedQty).minus(i.cancelledQty);
        const pack = largestPack(i.product.units.map((u) => ({ symbol: u.unit.symbol, factor: u.factor })));
        return { id: i.id, productId: i.productId, name: i.product.name, sku: i.product.sku, waiting: Number(waiting), waitingText: qtyText(Number(waiting), pack, i.product.baseUnit.symbol).main, symbol: i.product.baseUnit.symbol, imageV: i.product.image ? i.product.image.updatedAt.getTime() : null, pack };
      })
      .filter((l) => l.waiting > 0);
    const listNote: ListNote | null = block || lines.length === 0 ? null : { id: note.id, noteNo: note.noteNo, customer: note.sale.customer?.name ?? "Walk-in customer", winga: Boolean(note.sale.customer?.reseller), saleNo: note.sale.saleNo, paymentLabel: AUTH_LABEL[note.auth], lines };
    return { ok: true, message: JSON.stringify({ ok: true, noteId: note.id, noteNo: note.noteNo, blocked: block?.message ?? null, note: listNote }) } as ActionState;
  });
  if (!result.ok || !result.message) return { ok: false, code: "ERROR", message: result.error ?? "You are not allowed to scan pickup notes." };
  return JSON.parse(result.message) as ScanResult;
}
