-- CreateEnum
CREATE TYPE "PickupStatus" AS ENUM ('NEW', 'PREPARING', 'READY', 'PARTIAL', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PickupAuth" AS ENUM ('PAID', 'PART_PAID', 'CREDIT_APPROVED');

-- CreateEnum
CREATE TYPE "WarehouseEventType" AS ENUM ('RESERVED', 'PREPARING', 'READY', 'RELEASED', 'RESERVATION_FREED', 'SCAN_REJECTED');

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "pickupRequired" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "StockBalance" ADD COLUMN     "reserved" DECIMAL(14,3) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PickupNote" (
    "id" TEXT NOT NULL,
    "noteNo" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" "PickupStatus" NOT NULL DEFAULT 'NEW',
    "auth" "PickupAuth" NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedById" TEXT,
    "startedAt" TIMESTAMP(3),
    "readyById" TEXT,
    "readyAt" TIMESTAMP(3),
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,

    CONSTRAINT "PickupNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickupNoteItem" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "saleItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "releasedQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "cancelledQty" DECIMAL(14,3) NOT NULL DEFAULT 0,

    CONSTRAINT "PickupNoteItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickupRelease" (
    "id" TEXT NOT NULL,
    "releaseNo" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "releasedById" TEXT NOT NULL,
    "collectedBy" TEXT,
    "remark" TEXT,
    "submissionKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PickupRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickupReleaseItem" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "noteItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "PickupReleaseItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseEvent" (
    "id" TEXT NOT NULL,
    "type" "WarehouseEventType" NOT NULL,
    "locationId" TEXT,
    "productId" TEXT,
    "quantity" DECIMAL(14,3),
    "previousReserved" DECIMAL(14,3),
    "newReserved" DECIMAL(14,3),
    "pickupNoteId" TEXT,
    "detail" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PickupNote_noteNo_key" ON "PickupNote"("noteNo");

-- CreateIndex
CREATE UNIQUE INDEX "PickupNote_token_key" ON "PickupNote"("token");

-- CreateIndex
CREATE UNIQUE INDEX "PickupNote_saleId_key" ON "PickupNote"("saleId");

-- CreateIndex
CREATE INDEX "PickupNote_status_createdAt_idx" ON "PickupNote"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PickupNote_locationId_status_idx" ON "PickupNote"("locationId", "status");

-- CreateIndex
CREATE INDEX "PickupNote_createdAt_idx" ON "PickupNote"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PickupNoteItem_saleItemId_key" ON "PickupNoteItem"("saleItemId");

-- CreateIndex
CREATE INDEX "PickupNoteItem_noteId_idx" ON "PickupNoteItem"("noteId");

-- CreateIndex
CREATE INDEX "PickupNoteItem_productId_idx" ON "PickupNoteItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "PickupRelease_releaseNo_key" ON "PickupRelease"("releaseNo");

-- CreateIndex
CREATE UNIQUE INDEX "PickupRelease_submissionKey_key" ON "PickupRelease"("submissionKey");

-- CreateIndex
CREATE INDEX "PickupRelease_noteId_idx" ON "PickupRelease"("noteId");

-- CreateIndex
CREATE INDEX "PickupRelease_releasedById_createdAt_idx" ON "PickupRelease"("releasedById", "createdAt");

-- CreateIndex
CREATE INDEX "PickupReleaseItem_releaseId_idx" ON "PickupReleaseItem"("releaseId");

-- CreateIndex
CREATE INDEX "PickupReleaseItem_noteItemId_idx" ON "PickupReleaseItem"("noteItemId");

-- CreateIndex
CREATE INDEX "WarehouseEvent_pickupNoteId_createdAt_idx" ON "WarehouseEvent"("pickupNoteId", "createdAt");

-- CreateIndex
CREATE INDEX "WarehouseEvent_type_createdAt_idx" ON "WarehouseEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "WarehouseEvent_userId_createdAt_idx" ON "WarehouseEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "WarehouseEvent_createdAt_idx" ON "WarehouseEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "PickupNote" ADD CONSTRAINT "PickupNote_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupNote" ADD CONSTRAINT "PickupNote_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupNote" ADD CONSTRAINT "PickupNote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupNote" ADD CONSTRAINT "PickupNote_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupNote" ADD CONSTRAINT "PickupNote_readyById_fkey" FOREIGN KEY ("readyById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupNote" ADD CONSTRAINT "PickupNote_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupNote" ADD CONSTRAINT "PickupNote_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupNoteItem" ADD CONSTRAINT "PickupNoteItem_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "PickupNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupNoteItem" ADD CONSTRAINT "PickupNoteItem_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "SaleItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupNoteItem" ADD CONSTRAINT "PickupNoteItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupRelease" ADD CONSTRAINT "PickupRelease_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "PickupNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupRelease" ADD CONSTRAINT "PickupRelease_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupReleaseItem" ADD CONSTRAINT "PickupReleaseItem_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "PickupRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupReleaseItem" ADD CONSTRAINT "PickupReleaseItem_noteItemId_fkey" FOREIGN KEY ("noteItemId") REFERENCES "PickupNoteItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupReleaseItem" ADD CONSTRAINT "PickupReleaseItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseEvent" ADD CONSTRAINT "WarehouseEvent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseEvent" ADD CONSTRAINT "WarehouseEvent_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseEvent" ADD CONSTRAINT "WarehouseEvent_pickupNoteId_fkey" FOREIGN KEY ("pickupNoteId") REFERENCES "PickupNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseEvent" ADD CONSTRAINT "WarehouseEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────── Store Warehouse guards (Prisma cannot express these) ─────────────

-- Reserved stock is never negative and never more than what is physically there:
-- no movement (sale, transfer, adjustment, damage) can eat into goods that are already sold and waiting to be collected.
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_reserved_valid" CHECK ("reserved" >= 0 AND "reserved" <= "quantity");

ALTER TABLE "PickupNoteItem" ADD CONSTRAINT "PickupNoteItem_quantities_valid" CHECK (
  "quantity" > 0 AND "releasedQty" >= 0 AND "cancelledQty" >= 0 AND "releasedQty" + "cancelledQty" <= "quantity"
);
ALTER TABLE "PickupReleaseItem" ADD CONSTRAINT "PickupReleaseItem_quantity_positive" CHECK ("quantity" > 0);

-- A pickup note keeps its identity for ever, is never deleted, and a finished one (completed or cancelled) cannot change.
CREATE OR REPLACE FUNCTION pickup_note_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Pickup notes cannot be deleted';
  END IF;
  IF OLD."status" IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'A % pickup note cannot be changed', lower(OLD."status"::text);
  END IF;
  IF NEW."noteNo" <> OLD."noteNo" OR NEW."token" <> OLD."token" OR NEW."saleId" <> OLD."saleId"
     OR NEW."locationId" <> OLD."locationId" OR NEW."createdById" <> OLD."createdById"
     OR NEW."createdAt" <> OLD."createdAt" OR NEW."auth" <> OLD."auth" THEN
    RAISE EXCEPTION 'A pickup note''s identity cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "PickupNote_guard" BEFORE UPDATE OR DELETE ON "PickupNote" FOR EACH ROW EXECUTE FUNCTION pickup_note_guard();

-- A line keeps its product and quantity; only the collected / given-back quantities can grow.
CREATE OR REPLACE FUNCTION pickup_note_item_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Pickup note lines cannot be deleted';
  END IF;
  IF NEW."noteId" <> OLD."noteId" OR NEW."saleItemId" <> OLD."saleItemId" OR NEW."productId" <> OLD."productId" OR NEW."quantity" <> OLD."quantity" THEN
    RAISE EXCEPTION 'A pickup note line cannot be changed';
  END IF;
  IF NEW."releasedQty" < OLD."releasedQty" OR NEW."cancelledQty" < OLD."cancelledQty" THEN
    RAISE EXCEPTION 'Collected quantities can never go down';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "PickupNoteItem_guard" BEFORE UPDATE OR DELETE ON "PickupNoteItem" FOR EACH ROW EXECUTE FUNCTION pickup_note_item_guard();

-- Collection records and the warehouse activity log are append-only.
CREATE OR REPLACE FUNCTION warehouse_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% records cannot be changed or deleted', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "PickupRelease_guard" BEFORE UPDATE OR DELETE ON "PickupRelease" FOR EACH ROW EXECUTE FUNCTION warehouse_append_only();
CREATE TRIGGER "PickupReleaseItem_guard" BEFORE UPDATE OR DELETE ON "PickupReleaseItem" FOR EACH ROW EXECUTE FUNCTION warehouse_append_only();
CREATE TRIGGER "WarehouseEvent_guard" BEFORE UPDATE OR DELETE ON "WarehouseEvent" FOR EACH ROW EXECUTE FUNCTION warehouse_append_only();

-- The business's one existing location (the default store) becomes the Store Warehouse: its sales now reserve stock and make
-- pickup notes. Only the untouched original name is replaced (an owner's own name is kept); sales made before this are treated as collected.
UPDATE "Location" SET "pickupRequired" = true WHERE "isDefault" = true AND "type" = 'WAREHOUSE';
UPDATE "Location" SET "name" = 'Store Warehouse – Dar es Salaam', "code" = 'STORE'
 WHERE "isDefault" = true AND "type" = 'WAREHOUSE' AND "name" = 'Main Store' AND "code" = 'MAIN'
   AND NOT EXISTS (SELECT 1 FROM "Location" x WHERE x."code" = 'STORE' OR x."name" = 'Store Warehouse – Dar es Salaam');
