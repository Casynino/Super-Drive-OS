// Pickup notes: the document that lets goods leave the Store Warehouse.
//
// A sale made from a pickup location (the warehouse) does not take stock off the shelf. It RESERVES it (physical stock stays,
// available stock drops) and makes a pickup note with a QR code. Stock only leaves, as a SOLD ledger row, when the warehouse
// attendant confirms the goods were handed over. Everything below runs inside the caller's transaction.
//
// Lock order: Sale row -> pickup note row -> products/balances (sorted by product) -> COL counter.
import { randomBytes } from "node:crypto";
import { Prisma, type PickupAuth } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";
import { nextDocumentNo, reserveStock, unreserveStock, type Dec, type Tx } from "@/lib/inventory/engine";
import { moveStockTracked } from "@/lib/inventory/items";
import { PICKUP_QR_PREFIX } from "@/lib/qr";

const D = Prisma.Decimal;

export type PickupErrorCode = "INVALID" | "CANCELLED" | "ALREADY_COLLECTED" | "NOT_AUTHORIZED" | "MISMATCH" | "EMPTY" | "STATE";
/** A problem the attendant can understand: the note cannot be used the way he asked. */
export class PickupError extends Error {
  constructor(
    message: string,
    public code: PickupErrorCode,
  ) {
    super(message);
  }
}

export const TERMINAL = ["COMPLETED", "CANCELLED"] as const;

// ───────────── Making the note (called by postSale) ─────────────

export async function createPickupNote(
  tx: Tx,
  i: { saleId: string; saleNo: string; locationId: string; userId: string; auth: PickupAuth; lines: { saleItemId: string; productId: string; quantity: Dec }[] },
) {
  const sorted = [...i.lines].sort((a, b) => a.productId.localeCompare(b.productId) || a.saleItemId.localeCompare(b.saleItemId));
  const noteNo = await nextDocumentNo(tx, "PU");
  const note = await tx.pickupNote.create({
    data: {
      noteNo,
      token: randomBytes(24).toString("base64url"), // not guessable; the QR carries only this
      saleId: i.saleId,
      locationId: i.locationId,
      auth: i.auth,
      createdById: i.userId,
      items: { create: sorted.map((l) => ({ saleItemId: l.saleItemId, productId: l.productId, quantity: l.quantity })) },
    },
  });
  for (const l of sorted) {
    // refused (InsufficientStockError) when the available stock does not cover it: the whole sale then rolls back
    const r = await reserveStock(tx, { productId: l.productId, locationId: i.locationId, qty: l.quantity });
    await tx.warehouseEvent.create({
      data: { type: "RESERVED", locationId: i.locationId, productId: l.productId, quantity: l.quantity, previousReserved: r.previousReserved, newReserved: r.newReserved, pickupNoteId: note.id, detail: `Reserved for sale ${i.saleNo}`, userId: i.userId },
    });
  }
  return note;
}

// ───────────── Preparing ─────────────

async function lockNote(tx: Tx, noteId: string) {
  const peek = await tx.pickupNote.findUnique({ where: { id: noteId }, select: { saleId: true } });
  if (!peek) throw new PickupError("This pickup note does not exist.", "INVALID");
  await tx.$queryRaw`SELECT "id" FROM "Sale" WHERE "id" = ${peek.saleId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "PickupNote" WHERE "id" = ${noteId} FOR UPDATE`;
  return tx.pickupNote.findUniqueOrThrow({ where: { id: noteId }, include: { items: true, sale: { select: { id: true, saleNo: true, status: true, paymentStatus: true, amountPaid: true, customerId: true, items: { select: { id: true, unitCost: true } } } }, completedBy: { select: { name: true } } } });
}

function assertOpen(note: { status: string; noteNo: string; completedAt: Date | null; completedBy: { name: string } | null }) {
  if (note.status === "COMPLETED") throw new PickupError(`${note.noteNo} was already collected${note.completedAt ? ` on ${stamp(note.completedAt)}` : ""}${note.completedBy ? ` (released by ${note.completedBy.name})` : ""}.`, "ALREADY_COLLECTED");
  if (note.status === "CANCELLED") throw new PickupError(`${note.noteNo} was cancelled. Nothing can be released.`, "CANCELLED");
}

export const stamp = (d: Date) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" }).format(d);

/** NEW -> PREPARING: the attendant started picking the goods. */
export async function startPreparing(tx: Tx, i: { noteId: string; userId: string }) {
  const note = await lockNote(tx, i.noteId);
  assertOpen(note);
  if (note.status !== "NEW") return note; // already started: nothing to do
  const updated = await tx.pickupNote.update({ where: { id: note.id }, data: { status: "PREPARING", startedById: i.userId, startedAt: new Date() } });
  await tx.warehouseEvent.create({ data: { type: "PREPARING", locationId: note.locationId, pickupNoteId: note.id, detail: `Started preparing ${note.noteNo}`, userId: i.userId } });
  return updated;
}

/** Goods picked and set aside, waiting for the person to collect them. */
export async function markReady(tx: Tx, i: { noteId: string; userId: string }) {
  const note = await lockNote(tx, i.noteId);
  assertOpen(note);
  if (note.status === "READY" || note.status === "PARTIAL") return note;
  const now = new Date();
  const updated = await tx.pickupNote.update({
    where: { id: note.id },
    data: { status: "READY", readyById: i.userId, readyAt: now, ...(note.startedAt ? {} : { startedById: i.userId, startedAt: now }) },
  });
  await tx.warehouseEvent.create({ data: { type: "READY", locationId: note.locationId, pickupNoteId: note.id, detail: `${note.noteNo} is ready for collection`, userId: i.userId } });
  return updated;
}

// ───────────── Releasing the goods ─────────────

/** Does the payment side allow the goods to leave? (A sale only exists as paid or as credit that passed the credit rules; this re-checks it.) */
function authorised(note: { auth: PickupAuth }, sale: { paymentStatus: string; amountPaid: Dec; customerId: string | null }) {
  if (note.auth === "PAID") return sale.paymentStatus === "PAID";
  if (note.auth === "PART_PAID") return sale.amountPaid.gt(0) && sale.customerId !== null;
  return sale.customerId !== null; // CREDIT_APPROVED: credit needs a named customer
}

export async function releasePickup(
  tx: Tx,
  i: { noteId: string; userId: string; items?: { noteItemId: string; quantity: Dec }[]; collectedBy?: string | null; remark?: string | null; submissionKey: string },
) {
  const note = await lockNote(tx, i.noteId);
  assertOpen(note);
  if (note.sale.status !== "COMPLETED") throw new PickupError(`The sale for ${note.noteNo} was cancelled. Nothing can be released.`, "CANCELLED");
  if (!authorised(note, note.sale)) throw new PickupError(`${note.noteNo} is not authorised for release: the payment or credit approval is missing.`, "NOT_AUTHORIZED");

  const remaining = (it: (typeof note.items)[number]) => it.quantity.minus(it.releasedQty).minus(it.cancelledQty);
  // what leaves now: the lines the attendant entered, or everything still waiting
  const wanted: { item: (typeof note.items)[number]; qty: Dec }[] = [];
  if (i.items && i.items.length > 0) {
    for (const w of i.items) {
      if (w.quantity.lte(0)) continue;
      const item = note.items.find((x) => x.id === w.noteItemId);
      if (!item) throw new PickupError("A line does not belong to this pickup note.", "MISMATCH");
      if (w.quantity.gt(remaining(item))) throw new PickupError("A quantity is more than is still waiting to be collected.", "MISMATCH");
      wanted.push({ item, qty: w.quantity });
    }
  } else {
    for (const item of note.items) if (remaining(item).gt(0)) wanted.push({ item, qty: remaining(item) });
  }
  if (wanted.length === 0) throw new PickupError("Nothing to release: enter the quantity handed over.", "EMPTY");

  wanted.sort((a, b) => a.item.productId.localeCompare(b.item.productId) || a.item.id.localeCompare(b.item.id));
  const unitCost = new Map(note.sale.items.map((s) => [s.id, s.unitCost]));
  const events: { productId: string; qty: Dec; previousReserved: Dec; newReserved: Dec }[] = [];
  for (const w of wanted) {
    // the reservation ends and the physical stock leaves in the same step (ledger row, previous / new balance, who)
    const r = await unreserveStock(tx, { productId: w.item.productId, locationId: note.locationId, qty: w.qty });
    await moveStockTracked(
      tx,
      { productId: w.item.productId, locationId: note.locationId, type: "SOLD", delta: w.qty.neg(), unitCost: unitCost.get(w.item.saleItemId) ?? null, referenceType: "Sale", referenceId: note.sale.id, referenceNo: note.sale.saleNo, reason: `Collected · ${note.noteNo}`, userId: i.userId },
      { saleId: note.sale.id, saleItemId: w.item.saleItemId },
    );
    await tx.pickupNoteItem.update({ where: { id: w.item.id }, data: { releasedQty: { increment: w.qty } } });
    events.push({ productId: w.item.productId, qty: w.qty, previousReserved: r.previousReserved, newReserved: r.newReserved });
  }

  const releaseNo = await nextDocumentNo(tx, "COL");
  const release = await tx.pickupRelease.create({
    data: {
      releaseNo,
      noteId: note.id,
      releasedById: i.userId,
      collectedBy: i.collectedBy?.trim() || null,
      remark: i.remark?.trim() || null,
      submissionKey: i.submissionKey, // a double submit fails here
      items: { create: wanted.map((w) => ({ noteItemId: w.item.id, productId: w.item.productId, quantity: w.qty })) },
    },
  });
  for (const e of events) {
    await tx.warehouseEvent.create({ data: { type: "RELEASED", locationId: note.locationId, productId: e.productId, quantity: e.qty, previousReserved: e.previousReserved, newReserved: e.newReserved, pickupNoteId: note.id, detail: `${releaseNo} · goods released for ${note.noteNo}`, userId: i.userId } });
  }

  const left = note.items.reduce((t, it) => t.plus(remaining(it)), new D(0)).minus(wanted.reduce((t, w) => t.plus(w.qty), new D(0)));
  const completed = left.lte(0);
  await tx.pickupNote.update({ where: { id: note.id }, data: completed ? { status: "COMPLETED", completedById: i.userId, completedAt: new Date() } : { status: "PARTIAL" } });
  return { release, releaseNo, noteNo: note.noteNo, saleNo: note.sale.saleNo, completed, left };
}

// ───────────── A sale cancelled or returned before the goods left ─────────────

/** Gives back the reservation for goods that were never collected. */
export async function freePickupReservation(tx: Tx, i: { noteId: string; noteItemId: string; productId: string; locationId: string; qty: Dec; userId: string; reason: string }) {
  const r = await unreserveStock(tx, { productId: i.productId, locationId: i.locationId, qty: i.qty });
  await tx.pickupNoteItem.update({ where: { id: i.noteItemId }, data: { cancelledQty: { increment: i.qty } } });
  await tx.warehouseEvent.create({ data: { type: "RESERVATION_FREED", locationId: i.locationId, productId: i.productId, quantity: i.qty, previousReserved: r.previousReserved, newReserved: r.newReserved, pickupNoteId: i.noteId, detail: i.reason, userId: i.userId } });
}

/** After lines were given back: if nothing is left to collect the note is finished (cancelled if nothing was ever collected). */
export async function settlePickupNote(tx: Tx, i: { noteId: string; userId: string; reason: string }) {
  const current = await tx.pickupNote.findUnique({ where: { id: i.noteId }, select: { status: true } });
  if (!current || current.status === "COMPLETED" || current.status === "CANCELLED") return; // already finished: a finished note never changes
  const items = await tx.pickupNoteItem.findMany({ where: { noteId: i.noteId } });
  const open = items.reduce((t, it) => t.plus(it.quantity.minus(it.releasedQty).minus(it.cancelledQty)), new D(0));
  if (open.gt(0)) return;
  const collected = items.reduce((t, it) => t.plus(it.releasedQty), new D(0));
  await tx.pickupNote.update({
    where: { id: i.noteId },
    data: collected.gt(0) ? { status: "COMPLETED", completedById: i.userId, completedAt: new Date() } : { status: "CANCELLED", cancelledById: i.userId, cancelledAt: new Date(), cancelReason: i.reason },
  });
}

// ───────────── Looking a note up (scanner, order page) ─────────────

export type PickupView = Awaited<ReturnType<typeof loadPickup>>;

/** Finds a note by what the scanner read: the QR text (SDOPU:<token>), a bare token, or the printed number (PU-2026-000125). */
export function parseScan(raw: string): { token?: string; noteNo?: string } | null {
  const t = raw.trim();
  if (!t || t.length > 200) return null;
  if (t.startsWith(PICKUP_QR_PREFIX)) return { token: t.slice(PICKUP_QR_PREFIX.length) };
  if (/^PU-\d{4}-\d{6}$/i.test(t)) return { noteNo: t.toUpperCase() };
  if (/^[A-Za-z0-9_-]{20,64}$/.test(t)) return { token: t };
  return null;
}

export async function loadPickup(db: Pick<Db, "pickupNote">, where: { id?: string; token?: string; noteNo?: string }) {
  return db.pickupNote.findUnique({
    where: where.id ? { id: where.id } : where.token ? { token: where.token } : { noteNo: where.noteNo ?? "" },
    include: {
      createdBy: { select: { name: true } },
      readyBy: { select: { name: true } },
      completedBy: { select: { name: true } },
      cancelledBy: { select: { name: true } },
      location: { select: { name: true } },
      sale: { select: { id: true, saleNo: true, status: true, paymentStatus: true, amountPaid: true, total: true, customerId: true, createdAt: true, customer: { select: { name: true, reseller: { select: { id: true } } } } } },
      items: {
        orderBy: { id: "asc" },
        include: { product: { select: { id: true, name: true, sku: true, baseUnit: { select: { symbol: true } }, units: { select: { factor: true, unit: { select: { symbol: true } } } }, image: { select: { updatedAt: true } } } } },
      },
      releases: { orderBy: { createdAt: "desc" }, include: { releasedBy: { select: { name: true } }, items: true } },
    },
  });
}

/** Why the goods cannot be released right now, in words the attendant can act on (null = fine to release). */
export function pickupBlock(n: NonNullable<PickupView>): { code: PickupErrorCode; message: string } | null {
  if (n.status === "COMPLETED") return { code: "ALREADY_COLLECTED", message: `ALREADY COLLECTED${n.completedAt ? ` on ${stamp(n.completedAt)}` : ""}${n.completedBy ? ` · released by ${n.completedBy.name}` : ""}` };
  if (n.status === "CANCELLED") return { code: "CANCELLED", message: "CANCELLED. The sale was cancelled, nothing can be released." };
  if (n.sale.status !== "COMPLETED") return { code: "CANCELLED", message: "The sale was cancelled. Nothing can be released." };
  if (!authorised(n, n.sale)) return { code: "NOT_AUTHORIZED", message: "Not authorised: the payment or credit approval is missing." };
  return null;
}

/** A refused scan is kept: who tried which note, and why it was refused. */
export async function logScanRejected(db: Pick<Db, "warehouseEvent">, i: { userId: string; locationId?: string | null; noteId?: string | null; code: string; detail: string }) {
  await db.warehouseEvent.create({ data: { type: "SCAN_REJECTED", locationId: i.locationId ?? null, pickupNoteId: i.noteId ?? null, detail: `${i.code}: ${i.detail}`.slice(0, 300), userId: i.userId } });
}
