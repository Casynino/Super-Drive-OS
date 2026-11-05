-- CreateEnum
CREATE TYPE "SaleChannel" AS ENUM ('SHOP', 'RESELLER');

-- AlterEnum
ALTER TYPE "LocationType" ADD VALUE 'RESELLER';

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "channel" "SaleChannel" NOT NULL DEFAULT 'SHOP',
ADD COLUMN     "resellerId" TEXT;

-- CreateTable
CREATE TABLE "Reseller" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "businessName" TEXT,
    "phone" TEXT NOT NULL,
    "altPhone" TEXT,
    "address" TEXT,
    "salesLocation" TEXT,
    "idInfo" TEXT,
    "notes" TEXT,
    "settlementDays" INTEGER NOT NULL DEFAULT 14,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "customerId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Reseller_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResellerIssue" (
    "id" TEXT NOT NULL,
    "issueNo" TEXT NOT NULL,
    "resellerId" TEXT NOT NULL,
    "fromLocationId" TEXT NOT NULL,
    "toLocationId" TEXT NOT NULL,
    "expectedValue" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submissionKey" TEXT NOT NULL,

    CONSTRAINT "ResellerIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResellerIssueItem" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "enteredQty" DECIMAL(14,3) NOT NULL,
    "enteredUnitId" TEXT NOT NULL,
    "factor" DECIMAL(14,4) NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "basePrice" DECIMAL(14,4) NOT NULL,
    "lineValue" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "ResellerIssueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResellerReturn" (
    "id" TEXT NOT NULL,
    "returnNo" TEXT NOT NULL,
    "resellerId" TEXT NOT NULL,
    "fromLocationId" TEXT NOT NULL,
    "toLocationId" TEXT NOT NULL,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submissionKey" TEXT NOT NULL,

    CONSTRAINT "ResellerReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResellerReturnItem" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "enteredQty" DECIMAL(14,3) NOT NULL,
    "enteredUnitId" TEXT NOT NULL,
    "factor" DECIMAL(14,4) NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "condition" "ReturnCondition" NOT NULL,

    CONSTRAINT "ResellerReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Reseller_customerId_key" ON "Reseller"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Reseller_locationId_key" ON "Reseller"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "ResellerIssue_issueNo_key" ON "ResellerIssue"("issueNo");

-- CreateIndex
CREATE UNIQUE INDEX "ResellerIssue_submissionKey_key" ON "ResellerIssue"("submissionKey");

-- CreateIndex
CREATE INDEX "ResellerIssue_resellerId_createdAt_idx" ON "ResellerIssue"("resellerId", "createdAt");

-- CreateIndex
CREATE INDEX "ResellerIssueItem_issueId_idx" ON "ResellerIssueItem"("issueId");

-- CreateIndex
CREATE INDEX "ResellerIssueItem_productId_idx" ON "ResellerIssueItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ResellerReturn_returnNo_key" ON "ResellerReturn"("returnNo");

-- CreateIndex
CREATE UNIQUE INDEX "ResellerReturn_submissionKey_key" ON "ResellerReturn"("submissionKey");

-- CreateIndex
CREATE INDEX "ResellerReturn_resellerId_createdAt_idx" ON "ResellerReturn"("resellerId", "createdAt");

-- CreateIndex
CREATE INDEX "ResellerReturnItem_returnId_idx" ON "ResellerReturnItem"("returnId");

-- CreateIndex
CREATE INDEX "Sale_resellerId_idx" ON "Sale"("resellerId");

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "Reseller"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reseller" ADD CONSTRAINT "Reseller_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reseller" ADD CONSTRAINT "Reseller_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reseller" ADD CONSTRAINT "Reseller_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerIssue" ADD CONSTRAINT "ResellerIssue_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "Reseller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerIssue" ADD CONSTRAINT "ResellerIssue_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerIssue" ADD CONSTRAINT "ResellerIssue_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerIssue" ADD CONSTRAINT "ResellerIssue_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerIssueItem" ADD CONSTRAINT "ResellerIssueItem_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "ResellerIssue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerIssueItem" ADD CONSTRAINT "ResellerIssueItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerIssueItem" ADD CONSTRAINT "ResellerIssueItem_enteredUnitId_fkey" FOREIGN KEY ("enteredUnitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerReturn" ADD CONSTRAINT "ResellerReturn_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "Reseller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerReturn" ADD CONSTRAINT "ResellerReturn_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerReturn" ADD CONSTRAINT "ResellerReturn_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerReturn" ADD CONSTRAINT "ResellerReturn_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerReturnItem" ADD CONSTRAINT "ResellerReturnItem_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "ResellerReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerReturnItem" ADD CONSTRAINT "ResellerReturnItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerReturnItem" ADD CONSTRAINT "ResellerReturnItem_enteredUnitId_fkey" FOREIGN KEY ("enteredUnitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ───────────── Guards ─────────────
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_channel_matches_reseller" CHECK (("channel" = 'RESELLER') = ("resellerId" IS NOT NULL));
ALTER TABLE "Reseller" ADD CONSTRAINT "Reseller_settlement_days_valid" CHECK ("settlementDays" BETWEEN 0 AND 365);
ALTER TABLE "ResellerIssue" ADD CONSTRAINT "ResellerIssue_value_valid" CHECK ("expectedValue" >= 0);
ALTER TABLE "ResellerIssueItem" ADD CONSTRAINT "ResellerIssueItem_valid" CHECK ("quantity" > 0 AND "enteredQty" > 0 AND "unitPrice" >= 0 AND "basePrice" >= 0 AND "lineValue" >= 0);
ALTER TABLE "ResellerReturnItem" ADD CONSTRAINT "ResellerReturnItem_valid" CHECK ("quantity" > 0 AND "enteredQty" > 0);

-- Issues and returns are permanent documents; resellers can be deactivated but never deleted
CREATE TRIGGER "ResellerIssue_guard" BEFORE UPDATE OR DELETE ON "ResellerIssue" FOR EACH ROW EXECUTE FUNCTION immutable_row_guard();
CREATE TRIGGER "ResellerIssueItem_guard" BEFORE UPDATE OR DELETE ON "ResellerIssueItem" FOR EACH ROW EXECUTE FUNCTION immutable_row_guard();
CREATE TRIGGER "ResellerReturn_guard" BEFORE UPDATE OR DELETE ON "ResellerReturn" FOR EACH ROW EXECUTE FUNCTION immutable_row_guard();
CREATE TRIGGER "ResellerReturnItem_guard" BEFORE UPDATE OR DELETE ON "ResellerReturnItem" FOR EACH ROW EXECUTE FUNCTION immutable_row_guard();

CREATE OR REPLACE FUNCTION reseller_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Resellers cannot be deleted. Deactivate them instead.'; END IF;
  IF NEW."customerId" <> OLD."customerId" OR NEW."locationId" <> OLD."locationId" THEN RAISE EXCEPTION 'A reseller''s account and stock location cannot be changed'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Reseller_guard" BEFORE UPDATE OR DELETE ON "Reseller" FOR EACH ROW EXECUTE FUNCTION reseller_guard();
