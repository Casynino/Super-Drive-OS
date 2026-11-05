-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "discountReason" TEXT;

-- CreateTable
CREATE TABLE "ProductImage" (
    "productId" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "full" BYTEA NOT NULL,
    "thumb" BYTEA NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("productId")
);

-- CreateTable
CREATE TABLE "ProductPriceHistory" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "unitLabel" TEXT,
    "oldValue" DECIMAL(14,2),
    "newValue" DECIMAL(14,2),
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductPriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductPriceHistory_productId_createdAt_idx" ON "ProductPriceHistory"("productId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPriceHistory" ADD CONSTRAINT "ProductPriceHistory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Price history is a permanent record.
CREATE TRIGGER "ProductPriceHistory_immutable" BEFORE UPDATE OR DELETE ON "ProductPriceHistory" FOR EACH ROW EXECUTE FUNCTION stock_document_immutable();

-- The discount reason is part of the posted sale and cannot be edited afterwards.
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
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
