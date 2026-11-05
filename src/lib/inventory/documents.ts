// Posting of stock documents. Each function must be called inside db.$transaction and does everything
// (document rows + ledger + balances + cost) in that one transaction, so it all commits or none of it does.
import { Prisma, type AdjustmentKind, type ReceiptType, type StockMovementType } from "@/generated/prisma/client";
import { applyIncomingCost, lockBalance, lockProducts, moveStock, nextDocumentNo, type Dec, type Tx } from "./engine";
import type { ResolvedLine } from "./lines";

const D = Prisma.Decimal;

type Actor = { id: string };
const bySku = <T extends { productId: string }>(a: T, b: T) => a.productId.localeCompare(b.productId);

// ───────────── Receiving ─────────────

export type ReceiptLine = ResolvedLine & { lineTotal: Dec };

export async function postReceipt(
  tx: Tx,
  input: {
    type: ReceiptType;
    supplierId: string | null;
    locationId: string;
    supplierInvoice: string | null;
    receivedDate: Date;
    notes: string | null;
    submissionKey: string;
    lines: ReceiptLine[];
    user: Actor;
  },
) {
  const lines = [...input.lines].sort(bySku);
  const receiptNo = await nextDocumentNo(tx, "GRN");
  const totalCost = lines.reduce((s, l) => s.plus(l.lineTotal), new D(0));

  // Insert first: a duplicate submissionKey fails here, before any stock is touched.
  const receipt = await tx.stockReceipt.create({
    data: {
      receiptNo,
      type: input.type,
      supplierId: input.supplierId,
      locationId: input.locationId,
      supplierInvoice: input.supplierInvoice,
      receivedDate: input.receivedDate,
      notes: input.notes,
      totalCost,
      submissionKey: input.submissionKey,
      receivedById: input.user.id,
      items: {
        create: lines.map((l) => ({
          productId: l.productId,
          enteredQty: l.enteredQty,
          enteredUnitId: l.enteredUnitId,
          factor: l.factor,
          quantity: l.quantity,
          unitCost: l.lineTotal.div(l.quantity).toDecimalPlaces(4),
          lineTotal: l.lineTotal,
        })),
      },
    },
  });

  await lockProducts(tx, lines.map((l) => l.productId));
  for (const l of lines) {
    const unitCost = l.lineTotal.div(l.quantity).toDecimalPlaces(4);
    // A line with no cost known (0) must not drag the average cost down, so it is left out of the average.
    if (l.lineTotal.gt(0)) await applyIncomingCost(tx, l.productId, l.quantity, unitCost); // before the quantity moves in
    await moveStock(tx, {
      productId: l.productId,
      locationId: input.locationId,
      type: "RECEIVED",
      delta: l.quantity,
      unitCost,
      referenceType: "StockReceipt",
      referenceId: receipt.id,
      referenceNo: receiptNo,
      reason: input.type === "OPENING_STOCK" ? "Opening stock" : null,
      userId: input.user.id,
    });
  }
  return receipt;
}

// ───────────── Transfers ─────────────

export async function postTransfer(
  tx: Tx,
  input: { fromLocationId: string; toLocationId: string; notes: string | null; submissionKey: string; lines: ResolvedLine[]; user: Actor },
) {
  const lines = [...input.lines].sort(bySku);
  const transferNo = await nextDocumentNo(tx, "TRF");
  const transfer = await tx.stockTransfer.create({
    data: {
      transferNo,
      fromLocationId: input.fromLocationId,
      toLocationId: input.toLocationId,
      notes: input.notes,
      submissionKey: input.submissionKey,
      createdById: input.user.id,
      items: {
        create: lines.map((l) => ({
          productId: l.productId,
          enteredQty: l.enteredQty,
          enteredUnitId: l.enteredUnitId,
          factor: l.factor,
          quantity: l.quantity,
        })),
      },
    },
  });

  for (const l of lines) {
    const common = { productId: l.productId, unitCost: l.avgCost, referenceType: "StockTransfer", referenceId: transfer.id, referenceNo: transferNo, userId: input.user.id };
    const out = { ...common, locationId: input.fromLocationId, type: "TRANSFER_OUT" as StockMovementType, delta: l.quantity.neg() };
    const inn = { ...common, locationId: input.toLocationId, type: "TRANSFER_IN" as StockMovementType, delta: l.quantity };
    // Always lock the two balance rows in the same (location id) order, whichever way the transfer goes.
    for (const m of [out, inn].sort((a, b) => a.locationId.localeCompare(b.locationId))) await moveStock(tx, m);
  }
  return transfer;
}

// ───────────── Adjustments, damage, counts ─────────────

const MOVEMENT_FOR: Record<AdjustmentKind, StockMovementType> = {
  INCREASE: "ADJUSTMENT",
  DECREASE: "ADJUSTMENT",
  DAMAGE: "DAMAGED",
  COUNT: "CORRECTION",
};

export async function postAdjustment(
  tx: Tx,
  input: { kind: AdjustmentKind; locationId: string; reason: string; submissionKey: string; lines: ResolvedLine[]; user: Actor },
) {
  const lines = [...input.lines].sort(bySku);
  const adjustmentNo = await nextDocumentNo(tx, "ADJ");
  const adjustment = await tx.stockAdjustment.create({
    data: { adjustmentNo, kind: input.kind, locationId: input.locationId, reason: input.reason, submissionKey: input.submissionKey, createdById: input.user.id },
  });

  await lockProducts(tx, lines.map((l) => l.productId));
  const type = MOVEMENT_FOR[input.kind];
  let applied = 0;

  for (const l of lines) {
    // Quantity on hand right now, with the row locked so the count/delta cannot go stale.
    const systemQty = await lockBalance(tx, l.productId, input.locationId);
    const delta = input.kind === "COUNT" ? l.quantity.minus(systemQty) : input.kind === "INCREASE" ? l.quantity : l.quantity.neg();

    // Stock coming in is valued at the current average cost (falling back to the product's default cost).
    let unitCost: Dec = l.avgCost;
    if (delta.gt(0)) {
      if (unitCost.lte(0)) unitCost = l.purchasePrice;
      await applyIncomingCost(tx, l.productId, delta, unitCost);
    }

    if (!delta.isZero()) {
      await moveStock(tx, {
        productId: l.productId,
        locationId: input.locationId,
        type,
        delta,
        unitCost,
        referenceType: "StockAdjustment",
        referenceId: adjustment.id,
        referenceNo: adjustmentNo,
        reason: input.reason,
        userId: input.user.id,
      });
      applied++;
    }

    await tx.stockAdjustmentItem.create({
      data: {
        adjustmentId: adjustment.id,
        productId: l.productId,
        enteredQty: l.enteredQty,
        enteredUnitId: l.enteredUnitId,
        factor: l.factor,
        systemQty,
        delta,
        unitCost,
      },
    });
  }
  return { adjustment, applied };
}
