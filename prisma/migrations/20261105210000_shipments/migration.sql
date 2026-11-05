-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('EXPECTED', 'PARTIAL', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShipmentIssue" AS ENUM ('NONE', 'OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ReceivingStatus" AS ENUM ('DRAFT', 'CONFIRMED');

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "shipmentNo" TEXT NOT NULL,
    "supplierId" TEXT,
    "reference" TEXT,
    "expectedDate" DATE,
    "locationId" TEXT NOT NULL,
    "notes" TEXT,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'EXPECTED',
    "issue" "ShipmentIssue" NOT NULL DEFAULT 'NONE',
    "resolutionNote" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "createdById" TEXT NOT NULL,
    "submissionKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentItem" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "expectedQty" DECIMAL(14,3) NOT NULL,
    "enteredQty" DECIMAL(14,3) NOT NULL,
    "enteredUnitId" TEXT NOT NULL,
    "factor" DECIMAL(14,4) NOT NULL,
    "unitCost" DECIMAL(16,4),
    "lineCost" DECIMAL(14,2),
    "unexpected" BOOLEAN NOT NULL DEFAULT false,
    "missingQty" DECIMAL(14,3) NOT NULL DEFAULT 0,

    CONSTRAINT "ShipmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentReceiving" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "sessionNo" INTEGER NOT NULL,
    "status" "ReceivingStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "finishShipment" BOOLEAN NOT NULL DEFAULT false,
    "startedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "stockReceiptId" TEXT,

    CONSTRAINT "ShipmentReceiving_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentReceivingItem" (
    "id" TEXT NOT NULL,
    "receivingId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "shipmentItemId" TEXT,
    "enteredUnitId" TEXT NOT NULL,
    "factor" DECIMAL(14,4) NOT NULL,
    "enteredGood" DECIMAL(14,3) NOT NULL,
    "enteredDamaged" DECIMAL(14,3) NOT NULL,
    "goodQty" DECIMAL(14,3) NOT NULL,
    "damagedQty" DECIMAL(14,3) NOT NULL,
    "note" TEXT,

    CONSTRAINT "ShipmentReceivingItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_shipmentNo_key" ON "Shipment"("shipmentNo");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_submissionKey_key" ON "Shipment"("submissionKey");

-- CreateIndex
CREATE INDEX "Shipment_status_createdAt_idx" ON "Shipment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Shipment_issue_idx" ON "Shipment"("issue");

-- CreateIndex
CREATE INDEX "ShipmentItem_productId_idx" ON "ShipmentItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentItem_shipmentId_productId_key" ON "ShipmentItem"("shipmentId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentReceiving_stockReceiptId_key" ON "ShipmentReceiving"("stockReceiptId");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentReceiving_shipmentId_sessionNo_key" ON "ShipmentReceiving"("shipmentId", "sessionNo");

-- CreateIndex
CREATE INDEX "ShipmentReceivingItem_receivingId_idx" ON "ShipmentReceivingItem"("receivingId");

-- CreateIndex
CREATE INDEX "ShipmentReceivingItem_shipmentItemId_idx" ON "ShipmentReceivingItem"("shipmentItemId");

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_enteredUnitId_fkey" FOREIGN KEY ("enteredUnitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentReceiving" ADD CONSTRAINT "ShipmentReceiving_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentReceiving" ADD CONSTRAINT "ShipmentReceiving_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentReceiving" ADD CONSTRAINT "ShipmentReceiving_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentReceiving" ADD CONSTRAINT "ShipmentReceiving_stockReceiptId_fkey" FOREIGN KEY ("stockReceiptId") REFERENCES "StockReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentReceivingItem" ADD CONSTRAINT "ShipmentReceivingItem_receivingId_fkey" FOREIGN KEY ("receivingId") REFERENCES "ShipmentReceiving"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentReceivingItem" ADD CONSTRAINT "ShipmentReceivingItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentReceivingItem" ADD CONSTRAINT "ShipmentReceivingItem_shipmentItemId_fkey" FOREIGN KEY ("shipmentItemId") REFERENCES "ShipmentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentReceivingItem" ADD CONSTRAINT "ShipmentReceivingItem_enteredUnitId_fkey" FOREIGN KEY ("enteredUnitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ───────────── Shipment integrity guards ─────────────

ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_amounts_valid" CHECK ("expectedQty" >= 0 AND "enteredQty" >= 0 AND "factor" > 0 AND ("unitCost" IS NULL OR "unitCost" >= 0) AND ("lineCost" IS NULL OR "lineCost" >= 0) AND "missingQty" >= 0);
ALTER TABLE "ShipmentReceivingItem" ADD CONSTRAINT "ShipmentReceivingItem_amounts_valid" CHECK ("enteredGood" >= 0 AND "enteredDamaged" >= 0 AND "goodQty" >= 0 AND "damagedQty" >= 0 AND ("goodQty" + "damagedQty") > 0 AND "factor" > 0);
-- Only one draft counting sheet per shipment at a time
CREATE UNIQUE INDEX "ShipmentReceiving_one_draft" ON "ShipmentReceiving" ("shipmentId") WHERE "status" = 'DRAFT';
-- A confirmed count always points at the stock receipt it created
ALTER TABLE "ShipmentReceiving" ADD CONSTRAINT "ShipmentReceiving_confirmed_complete" CHECK ("status" = 'DRAFT' OR ("confirmedById" IS NOT NULL AND "confirmedAt" IS NOT NULL));

-- Shipments are never deleted; what was announced (who, where, how many, at what cost) cannot be edited.
CREATE OR REPLACE FUNCTION shipment_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Shipments cannot be deleted. Cancel them instead.'; END IF;
  IF NEW."shipmentNo" <> OLD."shipmentNo" OR NEW."createdById" <> OLD."createdById" OR NEW."locationId" <> OLD."locationId"
     OR NEW."supplierId" IS DISTINCT FROM OLD."supplierId" OR NEW."submissionKey" <> OLD."submissionKey" OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'The announced details of a shipment cannot be edited';
  END IF;
  IF OLD."status" IN ('RECEIVED', 'CANCELLED') AND NEW."status" <> OLD."status" THEN
    RAISE EXCEPTION 'A % shipment cannot change status', OLD."status";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Shipment_guard" BEFORE UPDATE OR DELETE ON "Shipment" FOR EACH ROW EXECUTE FUNCTION shipment_guard();

CREATE OR REPLACE FUNCTION shipment_item_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Shipment lines cannot be deleted'; END IF;
  IF NEW."shipmentId" <> OLD."shipmentId" OR NEW."productId" <> OLD."productId" OR NEW."expectedQty" <> OLD."expectedQty"
     OR NEW."enteredQty" <> OLD."enteredQty" OR NEW."factor" <> OLD."factor" OR NEW."unitCost" IS DISTINCT FROM OLD."unitCost"
     OR NEW."lineCost" IS DISTINCT FROM OLD."lineCost" OR NEW."unexpected" <> OLD."unexpected" THEN
    RAISE EXCEPTION 'The announced quantities and costs of a shipment line cannot be edited';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ShipmentItem_guard" BEFORE UPDATE OR DELETE ON "ShipmentItem" FOR EACH ROW EXECUTE FUNCTION shipment_item_guard();

-- A confirmed count is permanent. Drafts can be edited freely (their lines are replaced on every save).
CREATE OR REPLACE FUNCTION receiving_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'CONFIRMED' THEN RAISE EXCEPTION 'A confirmed receiving document cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" = 'CONFIRMED' THEN RAISE EXCEPTION 'A confirmed receiving document cannot be changed. Record a stock adjustment instead.'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ShipmentReceiving_guard" BEFORE UPDATE OR DELETE ON "ShipmentReceiving" FOR EACH ROW EXECUTE FUNCTION receiving_guard();

CREATE OR REPLACE FUNCTION receiving_item_guard() RETURNS trigger AS $$
DECLARE st text; rid text;
BEGIN
  rid := CASE WHEN TG_OP = 'DELETE' THEN OLD."receivingId" ELSE NEW."receivingId" END;
  SELECT "status" INTO st FROM "ShipmentReceiving" WHERE "id" = rid;
  IF st = 'CONFIRMED' AND (TG_OP <> 'INSERT' OR TRUE) THEN
    RAISE EXCEPTION 'The lines of a confirmed receiving document cannot be changed';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ShipmentReceivingItem_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ShipmentReceivingItem" FOR EACH ROW EXECUTE FUNCTION receiving_item_guard();
