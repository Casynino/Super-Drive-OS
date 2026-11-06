-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "arrivedAt" TIMESTAMP(3),
ADD COLUMN     "arrivedById" TEXT;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_arrivedById_fkey" FOREIGN KEY ("arrivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Shipments the shop had already counted (or finished) before this step existed count as arrived.
UPDATE "Shipment" s SET "arrivedAt" = COALESCE(s."closedAt", s."createdAt")
 WHERE s."arrivedAt" IS NULL
   AND (s."status" IN ('PARTIAL', 'RECEIVED') OR EXISTS (SELECT 1 FROM "ShipmentReceiving" r WHERE r."shipmentId" = s."id"));
