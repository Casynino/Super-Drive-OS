// Investigation: the problem products of a received shipment (missing, damaged, extra) and what the owner decides about them.
// Nothing here is stored as a second stock record. The stock side already happened when the shop counted:
//   good pieces went into stock, damaged ones were taken straight off the shelf count (status DAMAGED), missing ones never came in.
// So an "investigation record" is worked out from the counts of the shipment, minus the decisions made so far (ShipmentIssueDecision, append-only).
//
//   FOUND          missing pieces turned up      -> a normal receipt tied to the shipment; new item numbers; stock goes up
//   NOT_DELIVERED  the supplier never sent them  -> a shortage (supplier balance drops by their cost); optionally a replacement purchase order; NO stock
//   WRITE_OFF      damaged pieces can't be sold  -> the pieces are marked DISPOSED; they stay in the history, never on the shelf
//   DISCOUNT_SELL  damaged pieces can be sold    -> they move into a separate "(damaged packaging)" product with its own lower price and stock, so the normal price can never be used for them by accident
//   DISMISS        the record is removed from the list (a reason is always kept; stock and money do not change)
//   KEEP           extra pieces are accepted     -> recorded only (they are already in stock)
//
// Lock order: shipment row -> (receipt: GRN counter -> products -> balances) / (new order: PO counter). Call inside db.$transaction.
import { Prisma, type IssueAction, type IssueKind } from "@/generated/prisma/client";
import { applyIncomingCost, lockProducts, type Tx } from "@/lib/inventory/engine";
import { postReceipt } from "@/lib/inventory/documents";
import { disposeDamagedItems, isTracked, moveStockTracked } from "@/lib/inventory/items";
import { parseMoney } from "@/lib/money";
import { resolveLines } from "@/lib/inventory/lines";
import { todayYmd } from "@/lib/dashboard/range";
import { largestPack } from "@/lib/qty";
import { ShipmentError, createShipment } from "./engine";

const D = Prisma.Decimal;
type Reader = Pick<Tx, "shipment" | "shipmentReceivingItem" | "shipmentIssueDecision">;

/** What kind of problem the screen shows, in plain words. */
export type IssueType = "MISSING" | "NOT_SHIPPED" | "DAMAGED" | "EXTRA" | "UNEXPECTED";
export const ISSUE_TYPE_LABEL: Record<IssueType, string> = {
  MISSING: "Missing product",
  NOT_SHIPPED: "Listed but not shipped",
  DAMAGED: "Damaged product",
  EXTRA: "Quantity discrepancy",
  UNEXPECTED: "Product not on the order",
};
export const ACTION_LABEL: Record<IssueAction, string> = {
  FOUND: "Found and returned to stock",
  NOT_DELIVERED: "Confirmed not delivered",
  WRITE_OFF: "Written off",
  DISCOUNT_SELL: "Put on sale at a discount",
  DISMISS: "Removed from the list",
  KEEP: "Kept in stock",
};

export type IssueRecord = {
  /** shipmentItemId:kind, unique per record */
  key: string;
  shipmentId: string;
  shipmentNo: string;
  supplierName: string | null;
  shipmentItemId: string;
  productId: string;
  productName: string;
  sku: string;
  imageV: number | null;
  unit: string;
  /** what one carton (or one piece, when there is no pack) normally sells for; used to check a discount is lower */
  normalPrice: number | null;
  /** the carton: quantities are shown in it first (null when the product has no pack) */
  pack: { symbol: string; factor: number } | null;
  kind: IssueKind;
  type: IssueType;
  /** all pieces of this problem, how many are decided, how many are still open */
  total: number;
  resolved: number;
  open: number;
  description: string;
  /** pieces ordered and pieces that really arrived (all counts together), for writing the story in cartons or pieces */
  expected: number;
  arrived: number;
  reportedAt: Date | null;
  reportedBy: string | null;
  /** the cost of one piece (owner only; null when unknown or not asked for) */
  unitCost: number | null;
  history: { at: Date; by: string; action: IssueAction; quantity: number; receiptNo: string | null; newOrderNo: string | null; variantName: string | null; discountPrice: number | null; note: string | null }[];
};

const q = (n: number) => String(Number(n.toFixed(3)));

/** The normal selling price of the biggest pack (its own price when set, else piece price x pieces), or of one piece when there is no pack. */
function normalPackPrice(p: { sellingPrice: Prisma.Decimal; units: { factor: Prisma.Decimal; sellingPrice: Prisma.Decimal | null }[] }): number | null {
  const top = [...p.units].filter((u) => u.factor.gt(1)).sort((a, b) => b.factor.comparedTo(a.factor))[0];
  const price = top ? (top.sellingPrice ?? p.sellingPrice.mul(top.factor)) : p.sellingPrice;
  return price.gt(0) ? Number(price) : null;
}

/**
 * The problem products of the given shipments (or of every shipment with an open problem), each with how much is decided and how much is still open.
 * `withCost` adds the buying price of a piece; leave it off for anyone who may not see costs.
 */
export async function loadIssueRecords(db: Reader, opts: { shipmentIds?: string[]; withCost?: boolean } = {}): Promise<IssueRecord[]> {
  const shipments = await db.shipment.findMany({
    where: opts.shipmentIds ? { id: { in: opts.shipmentIds } } : { issue: "OPEN" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      shipmentNo: true,
      status: true,
      closedAt: true,
      closedBy: { select: { name: true } },
      supplier: { select: { name: true } },
      items: {
        orderBy: [{ unexpected: "asc" }, { id: "asc" }],
        select: {
          id: true,
          productId: true,
          expectedQty: true,
          missingQty: true,
          unexpected: true,
          ...(opts.withCost ? { unitCost: true } : {}),
          product: { select: { name: true, sku: true, baseUnit: { select: { symbol: true } }, image: { select: { updatedAt: true } }, units: { select: { factor: true, sellingPrice: true, unit: { select: { symbol: true } } } }, sellingPrice: true } },
        },
      },
    },
  });
  if (shipments.length === 0) return [];
  const ids = shipments.map((s) => s.id);

  const [counts, decisions] = await Promise.all([
    db.shipmentReceivingItem.findMany({
      where: { receiving: { shipmentId: { in: ids }, status: "CONFIRMED" } },
      select: { productId: true, goodQty: true, damagedQty: true, receiving: { select: { shipmentId: true, sessionNo: true, confirmedAt: true, confirmedBy: { select: { name: true } } } } },
      orderBy: { receiving: { sessionNo: "asc" } },
    }),
    db.shipmentIssueDecision.findMany({
      where: { shipmentId: { in: ids } },
      orderBy: { decidedAt: "asc" },
      select: { shipmentId: true, shipmentItemId: true, kind: true, action: true, quantity: true, note: true, decidedAt: true, discountPrice: true, decidedBy: { select: { name: true } }, stockReceipt: { select: { receiptNo: true } }, movedToShipment: { select: { shipmentNo: true } }, variantProduct: { select: { name: true } } },
    }),
  ]);

  const out: IssueRecord[] = [];
  for (const s of shipments) {
    for (const i of s.items) {
      const mine = counts.filter((c) => c.receiving.shipmentId === s.id && c.productId === i.productId);
      const good = mine.reduce((t, c) => t + Number(c.goodQty), 0);
      const damaged = mine.reduce((t, c) => t + Number(c.damagedQty), 0);
      const arrived = good + damaged;
      const expected = Number(i.expectedQty);
      const lastDamaged = [...mine].reverse().find((c) => Number(c.damagedQty) > 0)?.receiving;
      const lastCount = mine[mine.length - 1]?.receiving;
      const unitCost = opts.withCost && (i as { unitCost?: Prisma.Decimal | null }).unitCost != null ? Number((i as { unitCost?: Prisma.Decimal | null }).unitCost) : null;

      const problems: { kind: IssueKind; total: number }[] = [
        { kind: "DAMAGED", total: damaged },
        { kind: "MISSING", total: s.status === "RECEIVED" ? Number(i.missingQty) : 0 },
        { kind: "EXTRA", total: Math.max(arrived - expected, 0) },
      ];
      for (const p of problems) {
        if (p.total <= 0) continue;
        const done = decisions.filter((d) => d.shipmentItemId === i.id && d.kind === p.kind);
        const resolved = done.reduce((t, d) => t + Number(d.quantity), 0);
        const type: IssueType = p.kind === "DAMAGED" ? "DAMAGED" : p.kind === "MISSING" ? (arrived === 0 ? "NOT_SHIPPED" : "MISSING") : i.unexpected ? "UNEXPECTED" : "EXTRA";
        const description =
          type === "DAMAGED" ? `${q(p.total)} arrived damaged and were taken off the shelf count.`
          : type === "NOT_SHIPPED" ? `${q(expected)} were ordered. Nothing arrived.`
          : type === "MISSING" ? `${q(expected)} were ordered, ${q(arrived)} arrived.`
          : type === "UNEXPECTED" ? `${q(p.total)} arrived that are not on the order.`
          : `${q(p.total)} more arrived than the ${q(expected)} ordered.`;
        const reported = p.kind === "DAMAGED" ? lastDamaged : p.kind === "MISSING" ? null : lastCount;
        out.push({
          key: `${i.id}:${p.kind}`,
          shipmentId: s.id,
          shipmentNo: s.shipmentNo,
          supplierName: s.supplier?.name ?? null,
          shipmentItemId: i.id,
          productId: i.productId,
          productName: i.product.name,
          sku: i.product.sku,
          imageV: i.product.image ? i.product.image.updatedAt.getTime() : null,
          unit: i.product.baseUnit.symbol,
          normalPrice: normalPackPrice(i.product),
          pack: largestPack(i.product.units.map((u) => ({ symbol: u.unit.symbol, factor: u.factor }))),
          kind: p.kind,
          type,
          total: p.total,
          resolved,
          open: Math.max(p.total - resolved, 0),
          description,
          expected,
          arrived,
          reportedAt: p.kind === "MISSING" ? s.closedAt : (reported?.confirmedAt ?? null),
          reportedBy: p.kind === "MISSING" ? (s.closedBy?.name ?? null) : (reported?.confirmedBy?.name ?? null),
          unitCost,
          history: done.map((d) => ({
            at: d.decidedAt,
            by: d.decidedBy.name,
            action: d.action,
            quantity: Number(d.quantity),
            receiptNo: d.stockReceipt?.receiptNo ?? null,
            newOrderNo: d.movedToShipment?.shipmentNo ?? null,
            variantName: d.variantProduct?.name ?? null,
            discountPrice: d.discountPrice ? Number(d.discountPrice) : null,
            note: d.note,
          })),
        });
      }
    }
  }
  return out;
}

export type DecideInput = {
  shipmentId: string;
  shipmentItemId: string;
  kind: IssueKind;
  action: IssueAction;
  /** how many pieces this decision covers (partial is fine) */
  quantity: string;
  note: string | null;
  /** NOT_DELIVERED only: also put the missing pieces on a new purchase order */
  newOrder?: boolean;
  /** DISCOUNT_SELL only: the new selling price, per carton (or per piece when the product has no carton) */
  discountPrice?: string;
  /** one per form; a double submit is answered with the first result */
  submissionKey: string;
  user: { id: string };
  currencyDecimals: number;
};

const FITS: Record<IssueKind, IssueAction[]> = { MISSING: ["FOUND", "NOT_DELIVERED"], DAMAGED: ["WRITE_OFF", "DISCOUNT_SELL"], EXTRA: ["KEEP"] };
/** Any problem record can be removed from the list; the reason is mandatory and stays in the history. */
const canDo = (kind: IssueKind, action: IssueAction) => action === "DISMISS" || FITS[kind].includes(action);

/** Owner: decide about some (or all) of the open pieces of one problem product. Updates stock in the same transaction. */
export async function decideIssue(tx: Tx, input: DecideInput) {
  if (!canDo(input.kind, input.action)) throw new ShipmentError("That action does not fit this problem.");
  const qty = new D(input.quantity.trim() === "" ? "NaN" : input.quantity.trim());
  if (!qty.isFinite() || qty.lte(0)) throw new ShipmentError("Enter how many pieces.", { quantity: "Enter a number above zero." });
  const note = input.note?.trim() || null;
  if ((input.action === "WRITE_OFF" || input.action === "NOT_DELIVERED" || input.action === "DISMISS") && (note?.length ?? 0) < 3) throw new ShipmentError("Write a short reason.", { note: "Give a short reason." });

  await tx.$queryRaw`SELECT "id" FROM "Shipment" WHERE "id" = ${input.shipmentId} FOR UPDATE`;
  const again = await tx.shipmentIssueDecision.findUnique({ where: { submissionKey: input.submissionKey } });
  if (again) return { decision: again, receiptNo: null as string | null, newOrderNo: null as string | null, closed: false, repeated: true };

  const shipment = await tx.shipment.findUnique({ where: { id: input.shipmentId }, select: { id: true, shipmentNo: true, supplierId: true, cargoName: true, locationId: true, issue: true } });
  if (!shipment) throw new ShipmentError("This shipment no longer exists.");
  if (shipment.issue !== "OPEN") throw new ShipmentError("This investigation is already closed.");

  const records = await loadIssueRecords(tx, { shipmentIds: [shipment.id], withCost: true });
  const rec = records.find((r) => r.shipmentItemId === input.shipmentItemId && r.kind === input.kind);
  if (!rec) throw new ShipmentError("That problem was not found on this shipment.");
  if (qty.gt(rec.open)) throw new ShipmentError(`Only ${q(rec.open)} can still be decided here.`, { quantity: `At most ${q(rec.open)}.` });
  if ((await isTracked(tx, rec.productId)) && !qty.isInteger()) throw new ShipmentError("Enter a whole number of pieces.", { quantity: "Whole pieces only." });

  const product = await tx.product.findUniqueOrThrow({ where: { id: rec.productId }, select: { baseUnitId: true, purchasePrice: true } });
  const unitCost = rec.unitCost !== null && rec.unitCost > 0 ? new D(rec.unitCost) : product.purchasePrice;
  let stockReceiptId: string | null = null;
  let receiptNo: string | null = null;
  let movedToShipmentId: string | null = null;
  let newOrderNo: string | null = null;
  let variantProductId: string | null = null;
  let discountPerBase: Prisma.Decimal | null = null;

  if (input.action === "FOUND") {
    // Found pieces are received like any delivery, tied to this shipment, so they get item numbers and the batch history stays whole.
    await lockProducts(tx, [rec.productId]);
    const resolved = await resolveLines(tx, [{ productId: rec.productId, unitId: product.baseUnitId, quantity: qty.toString() }]);
    if (!resolved.ok) throw new ShipmentError(resolved.message);
    const lines = resolved.lines.map((l) => ({ ...l, lineTotal: unitCost.mul(qty).toDecimalPlaces(2), unitCost }));
    const receipt = await postReceipt(tx, {
      type: "PURCHASE",
      supplierId: shipment.supplierId,
      locationId: shipment.locationId,
      supplierInvoice: null,
      receivedDate: new Date(`${todayYmd()}T00:00:00.000Z`),
      notes: `Found after investigation, ${shipment.shipmentNo}${note ? `: ${note}` : ""}`,
      submissionKey: `issue-found:${input.submissionKey}`,
      lines,
      user: input.user,
      shipmentId: shipment.id,
    });
    stockReceiptId = receipt.id;
    receiptNo = receipt.receiptNo;
  } else if (input.action === "NOT_DELIVERED" && input.newOrder) {
    if (unitCost.lte(0)) throw new ShipmentError("This product has no buying price on record, so it cannot be put on a new order automatically. Confirm the shortage without the new order and add it by hand.");
    const order = await createShipment(tx, {
      user: input.user,
      supplierId: shipment.supplierId,
      reference: null,
      cargoName: shipment.cargoName,
      expectedDate: null,
      locationId: shipment.locationId,
      notes: `Replacement for ${shipment.shipmentNo}: pieces that were never delivered`,
      lines: [{ productId: rec.productId, unitId: product.baseUnitId, quantity: qty.toString(), totalCost: unitCost.mul(qty).toFixed(input.currencyDecimals) }],
      submissionKey: `issue-order:${input.submissionKey}`,
      currencyDecimals: input.currencyDecimals,
    });
    movedToShipmentId = order.id;
    newOrderNo = order.shipmentNo;
  } else if (input.action === "DISCOUNT_SELL") {
    // The pieces go back on sale as their own "(damaged packaging)" product at the price the owner sets. The normal product and its price are untouched.
    const orig = await tx.product.findUniqueOrThrow({ where: { id: rec.productId }, include: { units: true } });
    const pack = [...orig.units].filter((u) => u.factor.gt(1)).sort((a, b) => b.factor.comparedTo(a.factor))[0] ?? null;
    const typed = parseMoney(input.discountPrice ?? "", input.currencyDecimals);
    if (!typed || typed.lte(0)) throw new ShipmentError("Enter the discounted selling price.", { discountPrice: "Enter a price above zero." });
    const normal = pack ? (pack.sellingPrice ?? orig.sellingPrice.mul(pack.factor)) : orig.sellingPrice;
    if (typed.gte(normal)) throw new ShipmentError("The discounted price must be lower than the normal price.", { discountPrice: `Lower than the normal ${normal.toFixed(0)}.` });
    const perBase = (pack ? typed.div(pack.factor) : typed).toDecimalPlaces(2);
    const sku = `${orig.sku}-DMG`;
    let variant = await tx.product.findUnique({ where: { sku }, include: { units: true } });
    if (!variant) {
      variant = await tx.product.create({
        data: {
          sku,
          name: `${orig.name} (damaged packaging)`,
          description: `Same oil as ${orig.name}, packaging damaged, sold at a discount.`,
          categoryId: orig.categoryId,
          brandId: orig.brandId,
          packagingType: orig.packagingType,
          size: orig.size,
          baseUnitId: orig.baseUnitId,
          defaultSalesUnitId: orig.defaultSalesUnitId,
          defaultPurchaseUnitId: orig.defaultPurchaseUnitId,
          allowPieceSales: orig.allowPieceSales,
          purchasePrice: orig.purchasePrice,
          sellingPrice: perBase,
          createdById: input.user.id,
          units: { create: orig.units.map((u) => ({ unitId: u.unitId, factor: u.factor, sellingPrice: pack && u.unitId === pack.unitId ? typed : null })) },
        },
        include: { units: true },
      });
      await tx.productPriceHistory.create({ data: { productId: variant.id, field: "sellingPrice", oldValue: null, newValue: perBase, changedById: input.user.id } });
    } else if (!variant.sellingPrice.eq(perBase)) {
      // asked again with another price: the product follows the newest price
      await tx.productPriceHistory.create({ data: { productId: variant.id, field: "sellingPrice", oldValue: variant.sellingPrice, newValue: perBase, changedById: input.user.id } });
      await tx.product.update({ where: { id: variant.id }, data: { sellingPrice: perBase, status: "ACTIVE" } });
      if (pack) await tx.productUnit.updateMany({ where: { productId: variant.id, unitId: pack.unitId }, data: { sellingPrice: typed } });
    }
    await lockProducts(tx, [orig.id, variant.id]);
    await applyIncomingCost(tx, variant.id, qty, unitCost);
    await moveStockTracked(tx, { productId: variant.id, locationId: shipment.locationId, type: "ADJUSTMENT", delta: qty, unitCost, referenceType: "Shipment", referenceId: shipment.id, referenceNo: shipment.shipmentNo, reason: `Damaged packaging from ${shipment.shipmentNo}, put on sale at a discount${note ? `: ${note}` : ""}`, userId: input.user.id });
    await disposeDamagedItems(tx, { shipmentId: shipment.id, productId: orig.id, qty, referenceType: "Shipment", referenceId: shipment.id, referenceNo: shipment.shipmentNo, note: `Moved to ${variant.name} to be sold at a discount`, userId: input.user.id });
    variantProductId = variant.id;
    discountPerBase = perBase;
  } else if (input.action === "WRITE_OFF") {
    await disposeDamagedItems(tx, { shipmentId: shipment.id, productId: rec.productId, qty, referenceType: "Shipment", referenceId: shipment.id, referenceNo: shipment.shipmentNo, note: note ?? `Written off after investigation (${shipment.shipmentNo})`, userId: input.user.id });
  }

  const decision = await tx.shipmentIssueDecision.create({
    data: { shipmentId: shipment.id, shipmentItemId: rec.shipmentItemId, productId: rec.productId, kind: input.kind, action: input.action, quantity: qty, note, stockReceiptId, movedToShipmentId, discountPrice: discountPerBase, variantProductId, submissionKey: input.submissionKey, decidedById: input.user.id },
  });

  // When nothing is left open, the investigation closes by itself (the original note-based close still works too).
  const left = (await loadIssueRecords(tx, { shipmentIds: [shipment.id] })).some((r) => r.open > 0);
  if (!left) await tx.shipment.update({ where: { id: shipment.id }, data: { issue: "RESOLVED", resolutionNote: "Every problem product was decided.", resolvedById: input.user.id, resolvedAt: new Date() } });
  return { decision, receiptNo, newOrderNo, closed: !left, repeated: false };
}
