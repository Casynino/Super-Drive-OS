-- AlterTable
ALTER TABLE "ShipmentItem" ADD COLUMN     "packSellingPrice" DECIMAL(14,2);

-- CreateTable
CREATE TABLE "ShipmentDraft" (
    "id" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShipmentDraft_createdById_idx" ON "ShipmentDraft"("createdById");

-- AddForeignKey
ALTER TABLE "ShipmentDraft" ADD CONSTRAINT "ShipmentDraft_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
