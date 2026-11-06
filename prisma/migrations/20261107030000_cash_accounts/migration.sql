-- Many accounts per payment method (CRDB, NMB, M-PESA, ...), each with its number and holder.
-- Every existing account becomes the DEFAULT account of its method, so nothing changes until the owner adds more.
-- (Written so it can be run again safely.) The account a payment went into is the account of its cash ledger row, so
-- the posted Payment itself is not touched.
ALTER TABLE "CashAccount" ADD COLUMN IF NOT EXISTS "accountNumber" TEXT,
ADD COLUMN IF NOT EXISTS "holderName" TEXT,
ADD COLUMN IF NOT EXISTS "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN IF NOT EXISTS "isDefault" BOOLEAN NOT NULL DEFAULT false;

UPDATE "CashAccount" SET "isDefault" = true;

DROP INDEX IF EXISTS "CashAccount_locationId_method_key";
CREATE INDEX IF NOT EXISTS "CashAccount_locationId_method_idx" ON "CashAccount"("locationId", "method");
-- exactly one default per method at a location, and only one till (cash account) per location
CREATE UNIQUE INDEX IF NOT EXISTS "CashAccount_one_default_per_method" ON "CashAccount"("locationId", "method") WHERE "isDefault";
CREATE UNIQUE INDEX IF NOT EXISTS "CashAccount_one_cash_per_location" ON "CashAccount"("locationId") WHERE "method" = 'CASH';

-- the exact account an expense is paid from (empty = the default account of its method)
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "cashAccountId" TEXT;
ALTER TABLE "Expense" DROP CONSTRAINT IF EXISTS "Expense_cashAccountId_fkey";
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "CashAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
