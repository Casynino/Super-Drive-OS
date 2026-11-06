// Paying suppliers. What we owe a supplier is never stored: it is the cost of their shipments and purchase receipts
// minus the payments made to them. A payment is money out of one account (cash, mobile money or bank) and is written to
// the cash ledger in the same transaction. Lock order: cash account row -> document counter (same as deposits).
import { Prisma, type PaymentMethod } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";
import { nextDocumentNo, type Tx } from "@/lib/inventory/engine";
import { parseMoney } from "@/lib/money";
import { CashError, assertCanSpend, defaultLocationId, getAccount, lockAccount, postCash } from "./ledger";

const D = Prisma.Decimal;
const n = (v: unknown) => Number(v ?? 0);

export async function paySupplier(
  tx: Tx,
  input: { user: { id: string }; supplierId: string; shipmentId: string | null; amount: string; method: PaymentMethod; reference: string; notes: string | null; submissionKey: string; currencyDecimals: number; /** blank = the default location */ locationId?: string },
) {
  const fe: Record<string, string> = {};
  const amount = parseMoney(input.amount, input.currencyDecimals);
  if (!amount || amount.lte(0)) fe.amount = input.currencyDecimals === 0 ? "Enter a whole amount above zero." : "Enter an amount above zero.";
  if (input.method !== "CASH" && input.reference.trim().length < 2) fe.reference = "Enter the bank or mobile money reference.";
  if (Object.keys(fe).length || !amount) throw new CashError("Please fix the highlighted fields.", fe);

  const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
  if (!supplier) throw new CashError("This supplier no longer exists.");
  if (input.shipmentId) {
    const sh = await tx.shipment.findUnique({ where: { id: input.shipmentId }, select: { supplierId: true } });
    if (!sh || sh.supplierId !== supplier.id) throw new CashError("That shipment is not from this supplier.", { shipmentId: "Choose one of this supplier's shipments." });
  }
  const locationId = input.locationId ?? (await defaultLocationId(tx));
  const account = await getAccount(tx, locationId, input.method);
  await lockAccount(tx, account.id);
  const paymentNo = await nextDocumentNo(tx, "SPY");
  // Insert first: a double-submitted form fails here (unique key) before any money moves.
  const payment = await tx.supplierPayment.create({
    data: { paymentNo, supplierId: supplier.id, shipmentId: input.shipmentId, amount, method: input.method, reference: input.reference.trim() || null, notes: input.notes?.trim() || null, locationId, createdById: input.user.id, submissionKey: input.submissionKey },
  });
  await assertCanSpend(tx, account.id, input.method, amount, "amount");
  await postCash(tx, { locationId, method: input.method, type: "SUPPLIER_PAYMENT", amount: amount.neg(), referenceType: "SupplierPayment", referenceId: payment.id, referenceNo: paymentNo, description: `Paid ${supplier.name}`, userId: input.user.id });
  return { payment, supplier };
}

export type SupplierBalance = { id: string; name: string; purchases: number; paid: number; owed: number };

/** What each supplier has supplied (shipment costs + purchase receipts not already counted through a shipment, minus shortages the owner confirmed were never delivered), what was paid, and the balance. */
export async function getSupplierBalances(db: Pick<Db, "$queryRaw">): Promise<SupplierBalance[]> {
  const rows = await db.$queryRaw<{ id: string; name: string; shipments: Prisma.Decimal; receipts: Prisma.Decimal; shortages: Prisma.Decimal; paid: Prisma.Decimal }[]>`
    SELECT s."id", s."name",
      COALESCE((SELECT SUM(i."lineCost") FROM "ShipmentItem" i JOIN "Shipment" sh ON sh."id" = i."shipmentId" WHERE sh."supplierId" = s."id" AND sh."status" <> 'CANCELLED' AND i."unexpected" = false), 0) AS shipments,
      COALESCE((SELECT SUM(r."totalCost") FROM "StockReceipt" r WHERE r."supplierId" = s."id" AND r."type" = 'PURCHASE' AND NOT EXISTS (SELECT 1 FROM "ShipmentReceiving" sr WHERE sr."stockReceiptId" = r."id") AND NOT EXISTS (SELECT 1 FROM "ShipmentIssueDecision" d WHERE d."stockReceiptId" = r."id")), 0) AS receipts,
      COALESCE((SELECT SUM(ROUND(d."quantity" * i."unitCost", 2)) FROM "ShipmentIssueDecision" d JOIN "ShipmentItem" i ON i."id" = d."shipmentItemId" JOIN "Shipment" sh ON sh."id" = d."shipmentId" WHERE sh."supplierId" = s."id" AND sh."status" <> 'CANCELLED' AND d."action" = 'NOT_DELIVERED' AND i."unitCost" IS NOT NULL), 0) AS shortages,
      COALESCE((SELECT SUM(p."amount") FROM "SupplierPayment" p WHERE p."supplierId" = s."id"), 0) AS paid
      FROM "Supplier" s ORDER BY s."name"`;
  return rows.map((r) => ({ id: r.id, name: r.name, purchases: n(r.shipments) + n(r.receipts) - n(r.shortages), paid: n(r.paid), owed: n(r.shipments) + n(r.receipts) - n(r.shortages) - n(r.paid) }));
}

void D;
