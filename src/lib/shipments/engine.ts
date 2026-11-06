// Incoming shipments. Call these inside db.$transaction.
//
//   createShipment   OWNER announces stock that is on its way. Inventory does NOT change.
//   markArrived      SHOP says the delivery is at the shop. Counting is only possible after this.
//   saveDraft        SHOP counts what really arrived on a draft receiving document (editable, no stock change).
//   confirmSession   SHOP confirms the count. This is the ONLY moment stock increases.
//   cancelShipment   OWNER withdraws a shipment nobody has started counting.
//   resolveIssue     OWNER closes an investigation (damaged / missing / extra goods).
//
// Lock order: shipment row → GRN counter → product rows → stock balances (never touches customers or sales).
import { Prisma } from "@/generated/prisma/client";
import { lockProducts, moveStock, nextDocumentNo, type Dec, type Tx } from "@/lib/inventory/engine";
import { postReceipt } from "@/lib/inventory/documents";
import { resolveLines } from "@/lib/inventory/lines";
import { todayYmd } from "@/lib/dashboard/range";
import { parseMoney } from "@/lib/money";
import { toBaseQuantity, validateQuantity } from "@/lib/units";

const D = Prisma.Decimal;

/** A problem the person can fix. fieldErrors keys: "line.<n>", "location", "reason", … */
export class ShipmentError extends Error {
  constructor(
    message: string,
    public fieldErrors: Record<string, string> = {},
    public code?: "ALREADY_CONFIRMED",
  ) {
    super(message);
  }
}

// ───────────── Owner: announce ─────────────

export type CreateShipmentInput = {
  user: { id: string };
  supplierId: string | null;
  reference: string | null;
  expectedDate: string | null; // YYYY-MM-DD
  locationId: string;
  notes: string | null;
  /** sellingPrice / wholesalePrice: new price per piece (base unit); blank = keep the current price. They go live when the stock is counted in. */
  lines: { productId: string; unitId: string; quantity: string; totalCost: string; sellingPrice?: string; wholesalePrice?: string }[];
  submissionKey: string;
  currencyDecimals: number;
};

export async function createShipment(tx: Tx, input: CreateShipmentInput) {
  const resolved = await resolveLines(tx, input.lines.map((l) => ({ productId: l.productId, unitId: l.unitId, quantity: l.quantity })));
  if (!resolved.ok) throw new ShipmentError(resolved.message, Object.fromEntries(Object.entries(resolved.errors).map(([i, m]) => [`line.${i}`, m])));

  const errors: Record<string, string> = {};
  const price = (raw: string | undefined): Dec | null | "bad" => {
    const v = (raw ?? "").trim();
    if (!v) return null;
    const m = parseMoney(v, input.currencyDecimals);
    return m && m.gt(0) ? m : "bad";
  };
  const lines = resolved.lines.flatMap((l) => {
    const raw = input.lines[l.index]!;
    const cost = parseMoney(raw.totalCost, input.currencyDecimals);
    if (!cost || cost.lte(0)) {
      errors[`line.${l.index}`] = "Enter what this line cost you (buying price), landed.";
      return [];
    }
    const sell = price(raw.sellingPrice);
    const whole = price(raw.wholesalePrice);
    if (sell === "bad" || whole === "bad") {
      errors[`line.${l.index}`] = "Enter the selling price as a valid amount, or leave it empty.";
      return [];
    }
    // only a real change is stored; the same price as today means "no change"
    return [{
      l,
      lineCost: cost,
      unitCost: cost.div(l.quantity).toDecimalPlaces(4),
      sellingPrice: sell && !sell.eq(l.basePrice) ? sell : null,
      wholesalePrice: whole && !(l.baseWholesale && whole.eq(l.baseWholesale)) ? whole : null,
    }];
  });
  if (Object.keys(errors).length) throw new ShipmentError("Please fix the highlighted lines.", errors);

  const shipmentNo = await nextDocumentNo(tx, "SHP");
  return tx.shipment.create({
    data: {
      shipmentNo,
      supplierId: input.supplierId,
      reference: input.reference,
      expectedDate: input.expectedDate ? new Date(`${input.expectedDate}T00:00:00.000Z`) : null,
      locationId: input.locationId,
      notes: input.notes,
      createdById: input.user.id,
      submissionKey: input.submissionKey,
      items: {
        create: lines.map(({ l, lineCost, unitCost, sellingPrice, wholesalePrice }) => ({
          productId: l.productId,
          expectedQty: l.quantity,
          enteredQty: l.enteredQty,
          enteredUnitId: l.enteredUnitId,
          factor: l.factor,
          unitCost,
          lineCost,
          sellingPrice,
          wholesalePrice,
        })),
      },
    },
    include: { items: true },
  });
}

export async function cancelShipment(tx: Tx, input: { shipmentId: string; user: { id: string }; reason: string }) {
  if (input.reason.trim().length < 3) throw new ShipmentError("Say why it is cancelled.", { reason: "Give a short reason." });
  await tx.$queryRaw`SELECT "id" FROM "Shipment" WHERE "id" = ${input.shipmentId} FOR UPDATE`;
  const s = await tx.shipment.findUnique({ where: { id: input.shipmentId }, include: { _count: { select: { receivings: true } } } });
  if (!s) throw new ShipmentError("This shipment no longer exists.");
  if (s.status !== "EXPECTED" || s._count.receivings > 0 || s.arrivedAt) throw new ShipmentError("This shipment has already arrived at the shop, so it can no longer be cancelled. Check it and report anything wrong instead.");
  return tx.shipment.update({ where: { id: s.id }, data: { status: "CANCELLED", resolutionNote: input.reason.trim() } });
}

// ───────────── Shop: mark as arrived ─────────────

/** The shop says the delivery is at the door. Counting can only start after this. Pressing it twice is harmless. */
export async function markArrived(tx: Tx, input: { shipmentId: string; user: { id: string } }) {
  await tx.$queryRaw`SELECT "id" FROM "Shipment" WHERE "id" = ${input.shipmentId} FOR UPDATE`;
  const s = await tx.shipment.findUnique({ where: { id: input.shipmentId } });
  if (!s) throw new ShipmentError("This shipment no longer exists.");
  if (s.status === "CANCELLED") throw new ShipmentError("This shipment was cancelled.");
  if (s.status === "RECEIVED") throw new ShipmentError("This shipment is already fully received.");
  if (s.arrivedAt) return { shipment: s, already: true };
  const shipment = await tx.shipment.update({ where: { id: s.id }, data: { arrivedAt: new Date(), arrivedById: input.user.id } });
  return { shipment, already: false };
}

const NOT_ARRIVED = "Mark this shipment as arrived first, then count it.";

// ───────────── Shop: count (draft) ─────────────

export type CountLine = { shipmentItemId: string | null; productId: string; unitId: string; good: string; damaged: string; note: string | null };
export type SaveDraftInput = { shipmentId: string; user: { id: string }; notes: string | null; finish: boolean; lines: CountLine[] };

const blank0 = (v: string) => (v.trim() === "" ? "0" : v.trim());

/** Saves (replaces) the single draft counting sheet. Nothing about stock changes here. */
export async function saveDraft(tx: Tx, input: SaveDraftInput) {
  await tx.$queryRaw`SELECT "id" FROM "Shipment" WHERE "id" = ${input.shipmentId} FOR UPDATE`;
  const shipment = await tx.shipment.findUnique({ where: { id: input.shipmentId }, include: { items: true } });
  if (!shipment) throw new ShipmentError("This shipment no longer exists.");
  if (shipment.status !== "EXPECTED" && shipment.status !== "PARTIAL") throw new ShipmentError(shipment.status === "CANCELLED" ? "This shipment was cancelled." : "This shipment is already fully received.");
  if (!shipment.arrivedAt) throw new ShipmentError(NOT_ARRIVED);

  let session =await tx.shipmentReceiving.findFirst({ where: { shipmentId: shipment.id, status: "DRAFT" } });
  if (!session) {
    const last = await tx.shipmentReceiving.aggregate({ where: { shipmentId: shipment.id }, _max: { sessionNo: true } });
    session = await tx.shipmentReceiving.create({ data: { shipmentId: shipment.id, sessionNo: (last._max.sessionNo ?? 0) + 1, startedById: input.user.id } });
  }

  const products = await tx.product.findMany({ where: { id: { in: input.lines.map((l) => l.productId) } }, include: { baseUnit: true, units: { include: { unit: true } } } });
  const byId = new Map(products.map((p) => [p.id, p]));
  const errors: Record<string, string> = {};
  const seen = new Set<string>();
  const rows: Prisma.ShipmentReceivingItemUncheckedCreateWithoutReceivingInput[] = [];

  input.lines.forEach((l, i) => {
    const key = `line.${i}`;
    const p = byId.get(l.productId);
    if (!p || p.status !== "ACTIVE") return void (errors[key] = "This product is not available.");
    if (seen.has(p.id)) return void (errors[key] = `${p.name} is listed twice. Combine it into one line.`);
    seen.add(p.id);

    let factor = new D(1);
    let allowsDecimal = p.baseUnit.allowsDecimal;
    if (l.unitId !== p.baseUnitId) {
      const pu = p.units.find((u) => u.unitId === l.unitId);
      if (!pu) return void (errors[key] = `That unit is not set up for ${p.name}.`);
      factor = pu.factor;
      allowsDecimal = pu.unit.allowsDecimal;
    }
    const qty = (raw: string) => {
      const v = blank0(raw);
      if (/^0+(\.0+)?$/.test(v)) return { ok: true as const, entered: new D(0), base: new D(0) };
      const q = validateQuantity(v, allowsDecimal);
      if (!q.ok) return { ok: false as const, error: q.error };
      const b = toBaseQuantity(q.value, factor);
      return b.ok ? { ok: true as const, entered: q.value, base: b.value } : { ok: false as const, error: b.error };
    };
    const good = qty(l.good);
    const damaged = qty(l.damaged);
    if (!good.ok) return void (errors[key] = good.error);
    if (!damaged.ok) return void (errors[key] = damaged.error);
    if (good.base.isZero() && damaged.base.isZero()) return; // nothing counted for this line

    // A product that is on the shipment always counts against its announced line, even if the shop added it by hand.
    const item = shipment.items.find((x) => x.productId === p.id);
    if (l.shipmentItemId && l.shipmentItemId !== item?.id) return void (errors[key] = "This line does not belong to the shipment.");
    rows.push({ productId: p.id, shipmentItemId: item?.id ?? null, enteredUnitId: l.unitId, factor, enteredGood: good.entered, enteredDamaged: damaged.entered, goodQty: good.base, damagedQty: damaged.base, note: l.note?.trim() || null });
  });
  if (Object.keys(errors).length) throw new ShipmentError("Please fix the highlighted lines.", errors);

  await tx.shipmentReceivingItem.deleteMany({ where: { receivingId: session.id } });
  if (rows.length) await tx.shipmentReceivingItem.createMany({ data: rows.map((r) => ({ ...r, receivingId: session!.id })) });
  await tx.shipmentReceiving.update({ where: { id: session.id }, data: { notes: input.notes, finishShipment: input.finish } });
  return { sessionId: session.id, lines: rows.length };
}

// ───────────── Shop: confirm ─────────────

export async function confirmSession(tx: Tx, input: { shipmentId: string; sessionId: string; user: { id: string } }) {
  await tx.$queryRaw`SELECT "id" FROM "Shipment" WHERE "id" = ${input.shipmentId} FOR UPDATE`;
  const shipment = await tx.shipment.findUnique({ where: { id: input.shipmentId }, include: { items: true } });
  if (!shipment) throw new ShipmentError("This shipment no longer exists.");
  const session = await tx.shipmentReceiving.findUnique({ where: { id: input.sessionId }, include: { items: true } });
  if (!session || session.shipmentId !== shipment.id) throw new ShipmentError("This counting sheet was not found.");
  if (session.status === "CONFIRMED") throw new ShipmentError("This count was already confirmed.", {}, "ALREADY_CONFIRMED");
  if (shipment.status !== "EXPECTED" && shipment.status !== "PARTIAL") throw new ShipmentError(shipment.status === "CANCELLED" ? "This shipment was cancelled." : "This shipment is already fully received.");
  if (!shipment.arrivedAt) throw new ShipmentError(NOT_ARRIVED);
  if (session.items.length === 0 && !session.finishShipment) throw new ShipmentError("Nothing has been counted yet. Enter what arrived, or finish the shipment if nothing more is coming.");

  await lockProducts(tx, session.items.map((i) => i.productId));

  // Goods nobody announced become their own (unexpected) line so they are tracked and reported.
  const itemFor = new Map(shipment.items.map((i) => [i.productId, i]));
  for (const ri of session.items) {
    if (itemFor.has(ri.productId)) continue;
    const p = await tx.product.findUniqueOrThrow({ where: { id: ri.productId }, select: { baseUnitId: true } });
    const created = await tx.shipmentItem.create({ data: { shipmentId: shipment.id, productId: ri.productId, expectedQty: 0, enteredQty: 0, enteredUnitId: p.baseUnitId, factor: 1, unexpected: true } });
    itemFor.set(ri.productId, created);
  }

  // 1. Stock: everything that physically arrived goes in, then damaged goods are written off straight away.
  const arrived = session.items.map((ri) => ({ ri, total: ri.goodQty.plus(ri.damagedQty), item: itemFor.get(ri.productId)! }));
  let receiptNo: string | null = null;
  let receiptId: string | null = null;
  if (arrived.length > 0) {
    const products = await tx.product.findMany({ where: { id: { in: arrived.map((a) => a.ri.productId) } }, select: { id: true, baseUnitId: true, purchasePrice: true } });
    const pById = new Map(products.map((p) => [p.id, p]));
    const resolved = await resolveLines(tx, arrived.map((a) => ({ productId: a.ri.productId, unitId: pById.get(a.ri.productId)!.baseUnitId, quantity: a.total.toString() })));
    if (!resolved.ok) throw new ShipmentError(resolved.message);

    const lines = resolved.lines.map((l) => {
      const a = arrived[l.index]!;
      // The owner's landed cost; goods nobody announced fall back to the product's default price (may be 0 = cost unknown, so the average cost is left alone).
      const unitCost = a.item.unitCost ?? pById.get(a.ri.productId)!.purchasePrice;
      return { ...l, lineTotal: unitCost.mul(a.total).toDecimalPlaces(2), unitCost };
    });
    const receipt = await postReceipt(tx, {
      type: "PURCHASE",
      supplierId: shipment.supplierId,
      locationId: shipment.locationId,
      supplierInvoice: shipment.reference,
      receivedDate: new Date(`${todayYmd()}T00:00:00.000Z`),
      notes: `Shipment ${shipment.shipmentNo}, count ${session.sessionNo}${session.notes ? `: ${session.notes}` : ""}`,
      submissionKey: `shipment-receiving:${session.id}`,
      lines,
      user: input.user,
    });
    receiptNo = receipt.receiptNo;
    receiptId = receipt.id;

    for (const a of [...arrived].sort((x, y) => x.ri.productId.localeCompare(y.ri.productId))) {
      if (a.ri.damagedQty.lte(0)) continue;
      await moveStock(tx, {
        productId: a.ri.productId,
        locationId: shipment.locationId,
        type: "DAMAGED",
        delta: a.ri.damagedQty.neg(),
        unitCost: a.item.unitCost ?? pById.get(a.ri.productId)!.purchasePrice,
        referenceType: "Shipment",
        referenceId: shipment.id,
        referenceNo: `${shipment.shipmentNo}#${session.sessionNo}`,
        reason: `Damaged on arrival (${shipment.shipmentNo})`,
        userId: input.user.id,
      });
    }
  }

  // 1b. New selling prices the owner entered with the announcement go live now that this stock is on the shelf (once per line).
  for (const a of arrived) {
    const item = a.item;
    if (a.total.lte(0) || item.priceAppliedAt || (!item.sellingPrice && !item.wholesalePrice)) continue;
    const p = await tx.product.findUniqueOrThrow({ where: { id: a.ri.productId }, select: { sellingPrice: true, wholesalePrice: true } });
    const data: { sellingPrice?: Dec; wholesalePrice?: Dec } = {};
    const history: { field: string; oldValue: Dec | null; newValue: Dec }[] = [];
    if (item.sellingPrice && !item.sellingPrice.eq(p.sellingPrice)) {
      data.sellingPrice = item.sellingPrice;
      history.push({ field: "sellingPrice", oldValue: p.sellingPrice, newValue: item.sellingPrice });
    }
    if (item.wholesalePrice && !(p.wholesalePrice && item.wholesalePrice.eq(p.wholesalePrice))) {
      data.wholesalePrice = item.wholesalePrice;
      history.push({ field: "wholesalePrice", oldValue: p.wholesalePrice, newValue: item.wholesalePrice });
    }
    if (history.length) {
      await tx.product.update({ where: { id: a.ri.productId }, data });
      await tx.productPriceHistory.createMany({ data: history.map((h) => ({ productId: a.ri.productId, ...h, changedById: shipment.createdById })) });
    }
    await tx.shipmentItem.update({ where: { id: item.id }, data: { priceAppliedAt: new Date() } });
  }

  // 2. Close the count
  await tx.shipmentReceiving.update({ where: { id: session.id }, data: { status: "CONFIRMED", confirmedById: input.user.id, confirmedAt: new Date(), stockReceiptId: receiptId } });

  // 3. Where does the shipment stand now? (counted so far = good + damaged across all confirmed counts)
  const sums = await tx.shipmentReceivingItem.groupBy({ by: ["shipmentItemId", "productId"], where: { receiving: { shipmentId: shipment.id, status: "CONFIRMED" } }, _sum: { goodQty: true, damagedQty: true } });
  const accounted = new Map<string, Dec>();
  for (const s of sums) accounted.set(s.productId, (s._sum.goodQty ?? new D(0)).plus(s._sum.damagedQty ?? new D(0)));
  const allItems = await tx.shipmentItem.findMany({ where: { shipmentId: shipment.id } });
  const allCounted = allItems.filter((i) => !i.unexpected).every((i) => (accounted.get(i.productId) ?? new D(0)).gte(i.expectedQty));
  const finished = session.finishShipment || allCounted;

  const thisSession = new Map(session.items.map((i) => [i.productId, i]));
  const missing: { productId: string; qty: Dec }[] = [];
  if (finished) {
    for (const i of allItems) {
      const gap = i.expectedQty.minus(accounted.get(i.productId) ?? 0);
      if (gap.gt(0)) {
        await tx.shipmentItem.update({ where: { id: i.id }, data: { missingQty: gap } });
        missing.push({ productId: i.productId, qty: gap });
      }
    }
  }
  const damagedNow = session.items.reduce((s, i) => s.plus(i.damagedQty), new D(0));
  const extraNow = allItems.some((i) => thisSession.has(i.productId) && (accounted.get(i.productId) ?? new D(0)).gt(i.expectedQty));
  const problem = damagedNow.gt(0) || extraNow || missing.length > 0;

  await tx.shipment.update({
    where: { id: shipment.id },
    data: {
      status: finished ? "RECEIVED" : "PARTIAL",
      ...(finished ? { closedAt: new Date(), closedById: input.user.id } : {}),
      ...(problem ? { issue: "OPEN" } : {}),
    },
  });

  return { shipmentNo: shipment.shipmentNo, sessionNo: session.sessionNo, receiptNo, finished, problem, damaged: damagedNow, missing, extra: extraNow };
}

// ───────────── Owner: investigate ─────────────

export async function resolveIssue(tx: Tx, input: { shipmentId: string; user: { id: string }; note: string }) {
  const note = input.note.trim();
  if (note.length < 3) throw new ShipmentError("Write what you found or decided.", { note: "Give a short note." });
  await tx.$queryRaw`SELECT "id" FROM "Shipment" WHERE "id" = ${input.shipmentId} FOR UPDATE`;
  const s = await tx.shipment.findUnique({ where: { id: input.shipmentId } });
  if (!s) throw new ShipmentError("This shipment no longer exists.");
  if (s.issue !== "OPEN") throw new ShipmentError("There is no open problem on this shipment.");
  return tx.shipment.update({ where: { id: s.id }, data: { issue: "RESOLVED", resolutionNote: note, resolvedById: input.user.id, resolvedAt: new Date() } });
}
