-- AlterEnum
ALTER TYPE "CashTxType" ADD VALUE 'SUPPLIER_PAYMENT';

-- CreateTable
CREATE TABLE "SupplierPayment" (
    "id" TEXT NOT NULL,
    "paymentNo" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "shipmentId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "locationId" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "submissionKey" TEXT NOT NULL,

    CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPayment_paymentNo_key" ON "SupplierPayment"("paymentNo");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPayment_submissionKey_key" ON "SupplierPayment"("submissionKey");

-- CreateIndex
CREATE INDEX "SupplierPayment_supplierId_paidAt_idx" ON "SupplierPayment"("supplierId", "paidAt");

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_amount_positive" CHECK ("amount" > 0);
CREATE TRIGGER "SupplierPayment_guard" BEFORE UPDATE OR DELETE ON "SupplierPayment" FOR EACH ROW EXECUTE FUNCTION immutable_row_guard();
