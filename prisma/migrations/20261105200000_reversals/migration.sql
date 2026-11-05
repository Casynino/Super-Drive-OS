-- CreateEnum
CREATE TYPE "ReversalKind" AS ENUM ('CANCEL', 'RETURN');

-- CreateEnum
CREATE TYPE "ReversalStatus" AS ENUM ('PENDING', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReturnCondition" AS ENUM ('RESELLABLE', 'DAMAGED');

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "refundedTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "returnedTotal" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SaleReversal" (
    "id" TEXT NOT NULL,
    "reversalNo" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "kind" "ReversalKind" NOT NULL,
    "status" "ReversalStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "refundMethod" "PaymentMethod",
    "refundReference" TEXT,
    "returnValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "refundAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "submissionKey" TEXT NOT NULL,

    CONSTRAINT "SaleReversal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReversalItem" (
    "id" TEXT NOT NULL,
    "reversalId" TEXT NOT NULL,
    "saleItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "enteredQty" DECIMAL(14,3) NOT NULL,
    "factor" DECIMAL(14,4) NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "condition" "ReturnCondition" NOT NULL,
    "returnValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "costValue" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "ReversalItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SaleReversal_reversalNo_key" ON "SaleReversal"("reversalNo");

-- CreateIndex
CREATE UNIQUE INDEX "SaleReversal_submissionKey_key" ON "SaleReversal"("submissionKey");

-- CreateIndex
CREATE INDEX "SaleReversal_saleId_idx" ON "SaleReversal"("saleId");

-- CreateIndex
CREATE INDEX "SaleReversal_status_requestedAt_idx" ON "SaleReversal"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "ReversalItem_reversalId_idx" ON "ReversalItem"("reversalId");

-- CreateIndex
CREATE INDEX "ReversalItem_saleItemId_idx" ON "ReversalItem"("saleItemId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- AddForeignKey
ALTER TABLE "SaleReversal" ADD CONSTRAINT "SaleReversal_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReversal" ADD CONSTRAINT "SaleReversal_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReversal" ADD CONSTRAINT "SaleReversal_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReversalItem" ADD CONSTRAINT "ReversalItem_reversalId_fkey" FOREIGN KEY ("reversalId") REFERENCES "SaleReversal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReversalItem" ADD CONSTRAINT "ReversalItem_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "SaleItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReversalItem" ADD CONSTRAINT "ReversalItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ───────────── Returns / cancellations: money and status rules ─────────────
-- A sale keeps its original total. Returns add to "returnedTotal" (credit note), refunds to "refundedTotal".
--   net total = total - returnedTotal        net paid = amountPaid - refundedTotal
ALTER TABLE "Sale" DROP CONSTRAINT "Sale_amounts_valid";
ALTER TABLE "Sale" DROP CONSTRAINT "Sale_payment_status_consistent";

ALTER TABLE "Sale" ADD CONSTRAINT "Sale_amounts_valid" CHECK (
  "subtotal" >= 0 AND "discountTotal" >= 0 AND "total" > 0 AND "cogsTotal" >= 0
  AND "total" = "subtotal" - "discountTotal"
  AND "amountPaid" >= 0 AND "amountPaid" <= "total"
  AND "returnedTotal" >= 0 AND "returnedTotal" <= "total"
  AND "refundedTotal" >= 0 AND "refundedTotal" <= "amountPaid"
  AND ("amountPaid" - "refundedTotal") <= ("total" - "returnedTotal")
);

ALTER TABLE "Sale" ADD CONSTRAINT "Sale_payment_status_consistent" CHECK (
  ("returnedTotal" = "total" AND "status" = 'CANCELLED')
  OR ("returnedTotal" < "total" AND "status" = 'COMPLETED' AND (
        ("paymentStatus" = 'PAID' AND ("amountPaid" - "refundedTotal") = ("total" - "returnedTotal"))
     OR ("paymentStatus" = 'UNPAID' AND ("amountPaid" - "refundedTotal") = 0)
     OR ("paymentStatus" = 'PARTIALLY_PAID' AND ("amountPaid" - "refundedTotal") > 0 AND ("amountPaid" - "refundedTotal") < ("total" - "returnedTotal"))
  ))
);

-- Credit-note and refund totals only ever grow.
CREATE OR REPLACE FUNCTION sale_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Sales cannot be deleted. Cancel or reverse them instead.';
  END IF;
  IF NEW."saleNo" <> OLD."saleNo" OR NEW."subtotal" <> OLD."subtotal" OR NEW."discountTotal" <> OLD."discountTotal"
     OR NEW."total" <> OLD."total" OR NEW."cogsTotal" <> OLD."cogsTotal"
     OR NEW."customerId" IS DISTINCT FROM OLD."customerId" OR NEW."locationId" <> OLD."locationId"
     OR NEW."salespersonId" <> OLD."salespersonId" OR NEW."createdAt" <> OLD."createdAt"
     OR NEW."submissionKey" <> OLD."submissionKey" OR NEW."discountReason" IS DISTINCT FROM OLD."discountReason" THEN
    RAISE EXCEPTION 'A posted sale cannot be edited. Use a cancellation, return or adjustment instead.';
  END IF;
  IF NEW."returnedTotal" < OLD."returnedTotal" OR NEW."refundedTotal" < OLD."refundedTotal" THEN
    RAISE EXCEPTION 'Returned and refunded amounts can only increase';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ───────────── Reversal documents ─────────────
ALTER TABLE "SaleReversal" ADD CONSTRAINT "SaleReversal_amounts_valid" CHECK (
  "returnValue" >= 0 AND "refundAmount" >= 0 AND "refundAmount" <= "returnValue"
  AND ("status" = 'PENDING' OR "decidedById" IS NOT NULL)
);
ALTER TABLE "ReversalItem" ADD CONSTRAINT "ReversalItem_amounts_valid" CHECK ("enteredQty" > 0 AND "quantity" > 0 AND "factor" > 0 AND "returnValue" >= 0 AND "costValue" >= 0);

-- A request can be approved or rejected once; after that it is final. Its facts never change.
CREATE OR REPLACE FUNCTION reversal_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Returns and cancellations cannot be deleted';
  END IF;
  IF OLD."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'This return/cancellation is already %, so it can no longer change', OLD."status";
  END IF;
  IF NEW."saleId" <> OLD."saleId" OR NEW."kind" <> OLD."kind" OR NEW."reason" <> OLD."reason"
     OR NEW."requestedById" <> OLD."requestedById" OR NEW."reversalNo" <> OLD."reversalNo" OR NEW."submissionKey" <> OLD."submissionKey" THEN
    RAISE EXCEPTION 'The facts of a return/cancellation request cannot be edited';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "SaleReversal_guard" BEFORE UPDATE OR DELETE ON "SaleReversal" FOR EACH ROW EXECUTE FUNCTION reversal_guard();

CREATE OR REPLACE FUNCTION reversal_item_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Return lines cannot be deleted';
  END IF;
  IF (SELECT "status" FROM "SaleReversal" WHERE "id" = OLD."reversalId") <> 'PENDING' THEN
    RAISE EXCEPTION 'This return is already decided, so its lines can no longer change';
  END IF;
  IF NEW."reversalId" <> OLD."reversalId" OR NEW."saleItemId" <> OLD."saleItemId" OR NEW."productId" <> OLD."productId"
     OR NEW."enteredQty" <> OLD."enteredQty" OR NEW."quantity" <> OLD."quantity" OR NEW."factor" <> OLD."factor" OR NEW."condition" <> OLD."condition" THEN
    RAISE EXCEPTION 'Only the values can be filled in when a return is completed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ReversalItem_guard" BEFORE UPDATE OR DELETE ON "ReversalItem" FOR EACH ROW EXECUTE FUNCTION reversal_item_guard();
