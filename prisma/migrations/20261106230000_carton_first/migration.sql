-- Carton-first: which unit a product is bought and sold in by default, and whether single pieces may be sold.
-- Stock quantities are untouched (they stay in the base unit).
ALTER TABLE "Product" ADD COLUMN "defaultSalesUnitId" TEXT;
ALTER TABLE "Product" ADD COLUMN "defaultPurchaseUnitId" TEXT;
ALTER TABLE "Product" ADD COLUMN "allowPieceSales" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Product" ADD CONSTRAINT "Product_defaultSalesUnitId_fkey" FOREIGN KEY ("defaultSalesUnitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_defaultPurchaseUnitId_fkey" FOREIGN KEY ("defaultPurchaseUnitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Products that already have a pack (carton) default to it; everyone keeps being able to sell pieces, as before.
UPDATE "Product" p
   SET "defaultSalesUnitId" = x."unitId", "defaultPurchaseUnitId" = x."unitId"
  FROM (SELECT DISTINCT ON ("productId") "productId", "unitId" FROM "ProductUnit" ORDER BY "productId", "factor" DESC) x
 WHERE x."productId" = p."id";

-- One consistent label everywhere: CTN and PCS.
UPDATE "Unit" SET "symbol" = 'PCS' WHERE "symbol" = 'pc' AND NOT EXISTS (SELECT 1 FROM "Unit" WHERE "symbol" = 'PCS');
UPDATE "Unit" SET "symbol" = 'CTN' WHERE "symbol" = 'ctn' AND NOT EXISTS (SELECT 1 FROM "Unit" WHERE "symbol" = 'CTN');
