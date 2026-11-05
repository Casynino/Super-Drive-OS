-- CreateEnum
CREATE TYPE "ReportKind" AS ENUM ('SUMMARY', 'DETAIL', 'EXCEPTION');

-- CreateEnum
CREATE TYPE "ReportTrigger" AS ENUM ('SCHEDULED', 'MANUAL');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "WhatsAppReport" (
    "id" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "kind" "ReportKind" NOT NULL,
    "part" INTEGER NOT NULL,
    "parts" INTEGER NOT NULL,
    "trigger" "ReportTrigger" NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "content" TEXT NOT NULL,
    "toPhone" TEXT NOT NULL,
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "WhatsAppReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatsAppReport_businessDate_kind_idx" ON "WhatsAppReport"("businessDate", "kind");

-- CreateIndex
CREATE INDEX "WhatsAppReport_status_createdAt_idx" ON "WhatsAppReport"("status", "createdAt");


-- A scheduled report can exist only once per day, kind and part (the scheduler may run many times a day)
CREATE UNIQUE INDEX "WhatsAppReport_scheduled_once" ON "WhatsAppReport" ("businessDate", "kind", "part") WHERE "trigger" = 'SCHEDULED';
ALTER TABLE "WhatsAppReport" ADD CONSTRAINT "WhatsAppReport_part_valid" CHECK ("part" >= 1 AND "parts" >= 1 AND "part" <= "parts");
