-- CreateEnum
CREATE TYPE "CashTxType" AS ENUM ('SALE_PAYMENT', 'COLLECTION', 'REFUND', 'EXPENSE', 'EXPENSE_REVERSAL', 'DEPOSIT_OUT', 'DEPOSIT_IN', 'WITHDRAWAL', 'ADJUSTMENT', 'OPENING_BALANCE', 'CLOSING_DIFFERENCE');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "ClosingStatus" AS ENUM ('SUBMITTED', 'NEEDS_REVIEW', 'REVIEWED');

-- CreateTable
CREATE TABLE "CashAccount" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashTransaction" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "CashTxType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "businessDate" DATE NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "referenceNo" TEXT,
    "description" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closingId" TEXT,

    CONSTRAINT "CashTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "approvalLimit" DECIMAL(14,2),
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "expenseNo" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "expenseDate" DATE NOT NULL,
    "notes" TEXT,
    "receiptId" TEXT,
    "status" "ExpenseStatus" NOT NULL,
    "locationId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "reversedById" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "submissionKey" TEXT NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankDeposit" (
    "id" TEXT NOT NULL,
    "depositNo" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "bankReference" TEXT NOT NULL,
    "notes" TEXT,
    "slipId" TEXT,
    "businessDate" DATE NOT NULL,
    "closingId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submissionKey" TEXT NOT NULL,

    CONSTRAINT "BankDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyClosing" (
    "id" TEXT NOT NULL,
    "closingNo" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "openingCash" DECIMAL(14,2) NOT NULL,
    "expectedCash" DECIMAL(14,2) NOT NULL,
    "countedCash" DECIMAL(14,2) NOT NULL,
    "difference" DECIMAL(14,2) NOT NULL,
    "depositedNow" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cashCarried" DECIMAL(14,2) NOT NULL,
    "summary" JSONB NOT NULL,
    "notes" TEXT,
    "status" "ClosingStatus" NOT NULL,
    "submittedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "submissionKey" TEXT NOT NULL,

    CONSTRAINT "DailyClosing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashAccount_locationId_method_key" ON "CashAccount"("locationId", "method");

-- CreateIndex
CREATE INDEX "CashTransaction_accountId_closingId_idx" ON "CashTransaction"("accountId", "closingId");

-- CreateIndex
CREATE INDEX "CashTransaction_businessDate_idx" ON "CashTransaction"("businessDate");

-- CreateIndex
CREATE INDEX "CashTransaction_type_businessDate_idx" ON "CashTransaction"("type", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "CashTransaction_accountId_type_referenceType_referenceId_key" ON "CashTransaction"("accountId", "type", "referenceType", "referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_name_key" ON "ExpenseCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_expenseNo_key" ON "Expense"("expenseNo");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_submissionKey_key" ON "Expense"("submissionKey");

-- CreateIndex
CREATE INDEX "Expense_status_requestedAt_idx" ON "Expense"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "Expense_expenseDate_idx" ON "Expense"("expenseDate");

-- CreateIndex
CREATE INDEX "Expense_requestedById_requestedAt_idx" ON "Expense"("requestedById", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BankDeposit_depositNo_key" ON "BankDeposit"("depositNo");

-- CreateIndex
CREATE UNIQUE INDEX "BankDeposit_submissionKey_key" ON "BankDeposit"("submissionKey");

-- CreateIndex
CREATE INDEX "BankDeposit_businessDate_idx" ON "BankDeposit"("businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "DailyClosing_closingNo_key" ON "DailyClosing"("closingNo");

-- CreateIndex
CREATE UNIQUE INDEX "DailyClosing_submissionKey_key" ON "DailyClosing"("submissionKey");

-- CreateIndex
CREATE INDEX "DailyClosing_status_idx" ON "DailyClosing"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DailyClosing_locationId_businessDate_key" ON "DailyClosing"("locationId", "businessDate");

-- AddForeignKey
ALTER TABLE "CashAccount" ADD CONSTRAINT "CashAccount_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CashAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_closingId_fkey" FOREIGN KEY ("closingId") REFERENCES "DailyClosing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankDeposit" ADD CONSTRAINT "BankDeposit_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankDeposit" ADD CONSTRAINT "BankDeposit_slipId_fkey" FOREIGN KEY ("slipId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankDeposit" ADD CONSTRAINT "BankDeposit_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyClosing" ADD CONSTRAINT "DailyClosing_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyClosing" ADD CONSTRAINT "DailyClosing_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyClosing" ADD CONSTRAINT "DailyClosing_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ───────────── Guards: the cash ledger and closings cannot be edited or erased ─────────────

ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_amount_nonzero" CHECK ("amount" <> 0);
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_sign_matches_type" CHECK (
  CASE "type"
    WHEN 'SALE_PAYMENT' THEN "amount" > 0
    WHEN 'COLLECTION' THEN "amount" > 0
    WHEN 'DEPOSIT_IN' THEN "amount" > 0
    WHEN 'EXPENSE_REVERSAL' THEN "amount" > 0
    WHEN 'OPENING_BALANCE' THEN "amount" > 0
    WHEN 'REFUND' THEN "amount" < 0
    WHEN 'EXPENSE' THEN "amount" < 0
    WHEN 'DEPOSIT_OUT' THEN "amount" < 0
    WHEN 'WITHDRAWAL' THEN "amount" < 0
    ELSE TRUE
  END
);

CREATE OR REPLACE FUNCTION cash_tx_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Cash ledger rows cannot be deleted. Record a correction instead.'; END IF;
  IF NEW."id" <> OLD."id" OR NEW."accountId" <> OLD."accountId" OR NEW."type" <> OLD."type" OR NEW."amount" <> OLD."amount"
     OR NEW."businessDate" <> OLD."businessDate" OR NEW."referenceType" <> OLD."referenceType" OR NEW."referenceId" <> OLD."referenceId"
     OR NEW."userId" <> OLD."userId" OR NEW."createdAt" <> OLD."createdAt"
     OR NEW."referenceNo" IS DISTINCT FROM OLD."referenceNo" OR NEW."description" IS DISTINCT FROM OLD."description" THEN
    RAISE EXCEPTION 'Cash ledger rows cannot be edited. Record a correction instead.';
  END IF;
  IF OLD."closingId" IS NOT NULL AND NEW."closingId" IS DISTINCT FROM OLD."closingId" THEN
    RAISE EXCEPTION 'This cash entry already belongs to a daily closing';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "CashTransaction_guard" BEFORE UPDATE OR DELETE ON "CashTransaction" FOR EACH ROW EXECUTE FUNCTION cash_tx_guard();

ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_limit_valid" CHECK ("approvalLimit" IS NULL OR "approvalLimit" >= 0);
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_amount_positive" CHECK ("amount" > 0);

CREATE OR REPLACE FUNCTION expense_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Expenses cannot be deleted. Reverse the expense instead.'; END IF;
  IF NEW."amount" <> OLD."amount" OR NEW."method" <> OLD."method" OR NEW."categoryId" <> OLD."categoryId" OR NEW."expenseNo" <> OLD."expenseNo"
     OR NEW."description" <> OLD."description" OR NEW."expenseDate" <> OLD."expenseDate" OR NEW."locationId" <> OLD."locationId"
     OR NEW."requestedById" <> OLD."requestedById" OR NEW."receiptId" IS DISTINCT FROM OLD."receiptId" THEN
    RAISE EXCEPTION 'A recorded expense cannot be edited. Reverse it and record a new one.';
  END IF;
  IF NEW."status" <> OLD."status" THEN
    IF NOT ((OLD."status" = 'PENDING' AND NEW."status" IN ('APPROVED', 'REJECTED')) OR (OLD."status" = 'APPROVED' AND NEW."status" = 'REVERSED')) THEN
      RAISE EXCEPTION 'This expense cannot change from % to %', OLD."status", NEW."status";
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Expense_guard" BEFORE UPDATE OR DELETE ON "Expense" FOR EACH ROW EXECUTE FUNCTION expense_guard();

ALTER TABLE "BankDeposit" ADD CONSTRAINT "BankDeposit_amount_positive" CHECK ("amount" > 0);
CREATE OR REPLACE FUNCTION immutable_row_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% records are permanent and cannot be changed or deleted', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "CashTransaction_no_truncate" BEFORE TRUNCATE ON "CashTransaction" FOR EACH STATEMENT EXECUTE FUNCTION immutable_row_guard();
CREATE TRIGGER "BankDeposit_guard" BEFORE UPDATE OR DELETE ON "BankDeposit" FOR EACH ROW EXECUTE FUNCTION immutable_row_guard();
CREATE TRIGGER "Attachment_guard" BEFORE UPDATE OR DELETE ON "Attachment" FOR EACH ROW EXECUTE FUNCTION immutable_row_guard();

ALTER TABLE "DailyClosing" ADD CONSTRAINT "DailyClosing_figures_consistent" CHECK (
  "difference" = "countedCash" - "expectedCash" AND "cashCarried" = "countedCash" - "depositedNow" AND "countedCash" >= 0 AND "depositedNow" >= 0 AND "cashCarried" >= 0
);
CREATE OR REPLACE FUNCTION closing_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A daily closing cannot be deleted'; END IF;
  IF NEW."closingNo" <> OLD."closingNo" OR NEW."locationId" <> OLD."locationId" OR NEW."businessDate" <> OLD."businessDate"
     OR NEW."openingCash" <> OLD."openingCash" OR NEW."expectedCash" <> OLD."expectedCash" OR NEW."countedCash" <> OLD."countedCash"
     OR NEW."difference" <> OLD."difference" OR NEW."depositedNow" <> OLD."depositedNow" OR NEW."cashCarried" <> OLD."cashCarried"
     OR NEW."summary"::text <> OLD."summary"::text OR NEW."submittedById" <> OLD."submittedById" OR NEW."submittedAt" <> OLD."submittedAt"
     OR NEW."notes" IS DISTINCT FROM OLD."notes" THEN
    RAISE EXCEPTION 'A submitted daily closing is locked. Record an authorised cash adjustment to correct it.';
  END IF;
  IF NEW."status" <> OLD."status" AND NOT (OLD."status" IN ('SUBMITTED', 'NEEDS_REVIEW') AND NEW."status" = 'REVIEWED') THEN
    RAISE EXCEPTION 'This closing cannot change from % to %', OLD."status", NEW."status";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "DailyClosing_guard" BEFORE UPDATE OR DELETE ON "DailyClosing" FOR EACH ROW EXECUTE FUNCTION closing_guard();
