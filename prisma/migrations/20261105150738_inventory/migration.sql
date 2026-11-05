-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('RECEIVED', 'SOLD', 'CUSTOMER_RETURN', 'SUPPLIER_RETURN', 'TRANSFER_IN', 'TRANSFER_OUT', 'DAMAGED', 'ADJUSTMENT', 'CORRECTION');

-- CreateEnum
CREATE TYPE "ReceiptType" AS ENUM ('PURCHASE', 'OPENING_STOCK');

-- CreateEnum
CREATE TYPE "AdjustmentKind" AS ENUM ('INCREASE', 'DECREASE', 'DAMAGE', 'COUNT');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "avgCost" DECIMAL(16,4) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentCounter" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DocumentCounter_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "StockBalance" (
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockBalance_pkey" PRIMARY KEY ("productId","locationId")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "previousQty" DECIMAL(14,3) NOT NULL,
    "newQty" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(16,4),
    "referenceType" TEXT,
    "referenceId" TEXT,
    "referenceNo" TEXT,
    "reason" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReceipt" (
    "id" TEXT NOT NULL,
    "receiptNo" TEXT NOT NULL,
    "type" "ReceiptType" NOT NULL DEFAULT 'PURCHASE',
    "supplierId" TEXT,
    "locationId" TEXT NOT NULL,
    "supplierInvoice" TEXT,
    "receivedDate" DATE NOT NULL,
    "notes" TEXT,
    "totalCost" DECIMAL(14,2) NOT NULL,
    "submissionKey" TEXT NOT NULL,
    "receivedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReceiptItem" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "enteredQty" DECIMAL(14,3) NOT NULL,
    "enteredUnitId" TEXT NOT NULL,
    "factor" DECIMAL(14,4) NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(16,4) NOT NULL,
    "lineTotal" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "StockReceiptItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransfer" (
    "id" TEXT NOT NULL,
    "transferNo" TEXT NOT NULL,
    "fromLocationId" TEXT NOT NULL,
    "toLocationId" TEXT NOT NULL,
    "notes" TEXT,
    "submissionKey" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransferItem" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "enteredQty" DECIMAL(14,3) NOT NULL,
    "enteredUnitId" TEXT NOT NULL,
    "factor" DECIMAL(14,4) NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "StockTransferItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAdjustment" (
    "id" TEXT NOT NULL,
    "adjustmentNo" TEXT NOT NULL,
    "kind" "AdjustmentKind" NOT NULL,
    "locationId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "submissionKey" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAdjustmentItem" (
    "id" TEXT NOT NULL,
    "adjustmentId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "enteredQty" DECIMAL(14,3) NOT NULL,
    "enteredUnitId" TEXT NOT NULL,
    "factor" DECIMAL(14,4) NOT NULL,
    "systemQty" DECIMAL(14,3) NOT NULL,
    "delta" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(16,4),

    CONSTRAINT "StockAdjustmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_name_key" ON "Supplier"("name");

-- CreateIndex
CREATE INDEX "StockBalance_locationId_idx" ON "StockBalance"("locationId");

-- CreateIndex
CREATE INDEX "StockMovement_productId_locationId_createdAt_idx" ON "StockMovement"("productId", "locationId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_type_createdAt_idx" ON "StockMovement"("type", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_referenceType_referenceId_idx" ON "StockMovement"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "StockMovement_createdAt_idx" ON "StockMovement"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockReceipt_receiptNo_key" ON "StockReceipt"("receiptNo");

-- CreateIndex
CREATE UNIQUE INDEX "StockReceipt_submissionKey_key" ON "StockReceipt"("submissionKey");

-- CreateIndex
CREATE INDEX "StockReceipt_createdAt_idx" ON "StockReceipt"("createdAt");

-- CreateIndex
CREATE INDEX "StockReceipt_supplierId_idx" ON "StockReceipt"("supplierId");

-- CreateIndex
CREATE INDEX "StockReceiptItem_receiptId_idx" ON "StockReceiptItem"("receiptId");

-- CreateIndex
CREATE INDEX "StockReceiptItem_productId_idx" ON "StockReceiptItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransfer_transferNo_key" ON "StockTransfer"("transferNo");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransfer_submissionKey_key" ON "StockTransfer"("submissionKey");

-- CreateIndex
CREATE INDEX "StockTransfer_createdAt_idx" ON "StockTransfer"("createdAt");

-- CreateIndex
CREATE INDEX "StockTransferItem_transferId_idx" ON "StockTransferItem"("transferId");

-- CreateIndex
CREATE INDEX "StockTransferItem_productId_idx" ON "StockTransferItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "StockAdjustment_adjustmentNo_key" ON "StockAdjustment"("adjustmentNo");

-- CreateIndex
CREATE UNIQUE INDEX "StockAdjustment_submissionKey_key" ON "StockAdjustment"("submissionKey");

-- CreateIndex
CREATE INDEX "StockAdjustment_createdAt_idx" ON "StockAdjustment"("createdAt");

-- CreateIndex
CREATE INDEX "StockAdjustment_kind_idx" ON "StockAdjustment"("kind");

-- CreateIndex
CREATE INDEX "StockAdjustmentItem_adjustmentId_idx" ON "StockAdjustmentItem"("adjustmentId");

-- CreateIndex
CREATE INDEX "StockAdjustmentItem_productId_idx" ON "StockAdjustmentItem"("productId");

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReceipt" ADD CONSTRAINT "StockReceipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReceipt" ADD CONSTRAINT "StockReceipt_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReceipt" ADD CONSTRAINT "StockReceipt_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReceiptItem" ADD CONSTRAINT "StockReceiptItem_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "StockReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReceiptItem" ADD CONSTRAINT "StockReceiptItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReceiptItem" ADD CONSTRAINT "StockReceiptItem_enteredUnitId_fkey" FOREIGN KEY ("enteredUnitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_enteredUnitId_fkey" FOREIGN KEY ("enteredUnitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustmentItem" ADD CONSTRAINT "StockAdjustmentItem_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "StockAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustmentItem" ADD CONSTRAINT "StockAdjustmentItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustmentItem" ADD CONSTRAINT "StockAdjustmentItem_enteredUnitId_fkey" FOREIGN KEY ("enteredUnitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────── Inventory integrity guards ─────────────

-- Stock can never go negative (the engine also checks atomically, this is the last line of defence)
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_quantity_nonnegative" CHECK ("quantity" >= 0);

-- Ledger rows must be internally consistent
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_quantity_nonzero" CHECK ("quantity" <> 0);
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_balance_consistent" CHECK ("newQty" = "previousQty" + "quantity" AND "newQty" >= 0);

-- The ledger is append-only: no UPDATE, DELETE or TRUNCATE
CREATE OR REPLACE FUNCTION stock_movement_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'StockMovement is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "StockMovement_no_update_delete"
  BEFORE UPDATE OR DELETE ON "StockMovement"
  FOR EACH ROW EXECUTE FUNCTION stock_movement_immutable();
CREATE TRIGGER "StockMovement_no_truncate"
  BEFORE TRUNCATE ON "StockMovement"
  FOR EACH STATEMENT EXECUTE FUNCTION stock_movement_immutable();

-- Documents are never edited or deleted once posted (corrections are new adjustment documents)
CREATE OR REPLACE FUNCTION stock_document_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is a posted document and cannot be changed (% not allowed)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "StockReceipt_immutable" BEFORE UPDATE OR DELETE ON "StockReceipt" FOR EACH ROW EXECUTE FUNCTION stock_document_immutable();
CREATE TRIGGER "StockReceiptItem_immutable" BEFORE UPDATE OR DELETE ON "StockReceiptItem" FOR EACH ROW EXECUTE FUNCTION stock_document_immutable();
CREATE TRIGGER "StockTransfer_immutable" BEFORE UPDATE OR DELETE ON "StockTransfer" FOR EACH ROW EXECUTE FUNCTION stock_document_immutable();
CREATE TRIGGER "StockTransferItem_immutable" BEFORE UPDATE OR DELETE ON "StockTransferItem" FOR EACH ROW EXECUTE FUNCTION stock_document_immutable();
CREATE TRIGGER "StockAdjustment_immutable" BEFORE UPDATE OR DELETE ON "StockAdjustment" FOR EACH ROW EXECUTE FUNCTION stock_document_immutable();
CREATE TRIGGER "StockAdjustmentItem_immutable" BEFORE UPDATE OR DELETE ON "StockAdjustmentItem" FOR EACH ROW EXECUTE FUNCTION stock_document_immutable();

-- Document line sanity
ALTER TABLE "StockReceiptItem" ADD CONSTRAINT "StockReceiptItem_amounts_valid" CHECK ("quantity" > 0 AND "enteredQty" > 0 AND "factor" > 0 AND "unitCost" >= 0 AND "lineTotal" >= 0);
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_amounts_valid" CHECK ("quantity" > 0 AND "enteredQty" > 0 AND "factor" > 0);
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_distinct_locations" CHECK ("fromLocationId" <> "toLocationId");
ALTER TABLE "StockAdjustmentItem" ADD CONSTRAINT "StockAdjustmentItem_amounts_valid" CHECK ("delta" <> 0 AND "enteredQty" >= 0 AND "factor" > 0 AND "systemQty" >= 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_avgCost_nonnegative" CHECK ("avgCost" >= 0);
