-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('AVAILABLE', 'SOLD', 'WITH_RESELLER', 'DAMAGED', 'MISSING', 'DISPOSED');

-- CreateEnum
CREATE TYPE "ItemEventKind" AS ENUM ('RECEIVED', 'ADDED', 'SOLD', 'RETURNED', 'TRANSFERRED', 'ISSUED_TO_RESELLER', 'RETURNED_FROM_RESELLER', 'SOLD_BY_RESELLER', 'DAMAGED', 'MISSING', 'RESTORED', 'DISPOSED');

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "itemNo" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" "ItemStatus" NOT NULL DEFAULT 'AVAILABLE',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receiptId" TEXT,
    "shipmentId" TEXT,
    "saleId" TEXT,
    "saleItemId" TEXT,
    "lastMovementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemMovement" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "kind" "ItemEventKind" NOT NULL,
    "fromStatus" "ItemStatus",
    "toStatus" "ItemStatus" NOT NULL,
    "fromLocationId" TEXT,
    "toLocationId" TEXT NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "referenceNo" TEXT,
    "note" TEXT,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_itemNo_key" ON "InventoryItem"("itemNo");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_token_key" ON "InventoryItem"("token");

-- CreateIndex
CREATE INDEX "InventoryItem_productId_locationId_status_receivedAt_itemNo_idx" ON "InventoryItem"("productId", "locationId", "status", "receivedAt", "itemNo");

-- CreateIndex
CREATE INDEX "InventoryItem_status_idx" ON "InventoryItem"("status");

-- CreateIndex
CREATE INDEX "InventoryItem_shipmentId_idx" ON "InventoryItem"("shipmentId");

-- CreateIndex
CREATE INDEX "InventoryItem_receiptId_idx" ON "InventoryItem"("receiptId");

-- CreateIndex
CREATE INDEX "InventoryItem_saleItemId_idx" ON "InventoryItem"("saleItemId");

-- CreateIndex
CREATE INDEX "InventoryItem_saleId_idx" ON "InventoryItem"("saleId");

-- CreateIndex
CREATE INDEX "ItemMovement_itemId_createdAt_idx" ON "ItemMovement"("itemId", "createdAt");

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "StockReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemMovement" ADD CONSTRAINT "ItemMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemMovement" ADD CONSTRAINT "ItemMovement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- An item's history is never edited or deleted.
CREATE OR REPLACE FUNCTION item_movement_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Item movements cannot be changed or deleted';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ItemMovement_guard" BEFORE UPDATE OR DELETE ON "ItemMovement" FOR EACH ROW EXECUTE FUNCTION item_movement_guard();

-- An item keeps its identity for ever, and its status or location can only change together with a recorded movement
-- (the movement must belong to this item and say exactly where it ended up).
CREATE OR REPLACE FUNCTION inventory_item_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Items cannot be deleted'; END IF;
  IF NEW."itemNo" <> OLD."itemNo" OR NEW."token" <> OLD."token" OR NEW."productId" <> OLD."productId"
     OR NEW."receivedAt" <> OLD."receivedAt" OR NEW."createdAt" <> OLD."createdAt"
     OR NEW."receiptId" IS DISTINCT FROM OLD."receiptId" OR NEW."shipmentId" IS DISTINCT FROM OLD."shipmentId" THEN
    RAISE EXCEPTION 'The identity of an item cannot be changed';
  END IF;
  IF NEW."status" <> OLD."status" OR NEW."locationId" <> OLD."locationId" THEN
    IF NEW."lastMovementId" IS NOT DISTINCT FROM OLD."lastMovementId"
       OR NOT EXISTS (SELECT 1 FROM "ItemMovement" m WHERE m."id" = NEW."lastMovementId" AND m."itemId" = NEW."id" AND m."toStatus" = NEW."status" AND m."toLocationId" = NEW."locationId") THEN
      RAISE EXCEPTION 'An item status or location can only change together with a recorded movement';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "InventoryItem_guard" BEFORE UPDATE OR DELETE ON "InventoryItem" FOR EACH ROW EXECUTE FUNCTION inventory_item_guard();
