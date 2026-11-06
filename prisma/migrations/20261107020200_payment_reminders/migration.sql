-- Automatic WhatsApp payment reminders: one row per customer per day, created before sending so nobody is messaged twice.
CREATE TABLE "PaymentReminder" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "trigger" "ReportTrigger" NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'SENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "saleIds" JSONB NOT NULL,
    "totalOwed" DECIMAL(14,2) NOT NULL,
    "toPhone" TEXT NOT NULL,
    "providerId" TEXT,
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "PaymentReminder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentReminder_customerId_businessDate_key" ON "PaymentReminder"("customerId", "businessDate");
CREATE INDEX "PaymentReminder_status_createdAt_idx" ON "PaymentReminder"("status", "createdAt");
CREATE INDEX "PaymentReminder_createdAt_idx" ON "PaymentReminder"("createdAt");

ALTER TABLE "PaymentReminder" ADD CONSTRAINT "PaymentReminder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
