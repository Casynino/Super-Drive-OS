-- AlterTable
ALTER TABLE "ShipmentItem" ADD COLUMN     "priceAppliedAt" TIMESTAMP(3),
ADD COLUMN     "sellingPrice" DECIMAL(14,2),
ADD COLUMN     "wholesalePrice" DECIMAL(14,2);
