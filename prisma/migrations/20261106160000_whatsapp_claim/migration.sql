-- AlterEnum
ALTER TYPE "ReportStatus" ADD VALUE 'SENDING';

-- AlterTable
ALTER TABLE "WhatsAppReport" ADD COLUMN     "claimedAt" TIMESTAMP(3);

