-- DropIndex
DROP INDEX "PaymentAllocation_paymentId_saleId_key";

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "submissionKey" TEXT;

-- AlterTable
ALTER TABLE "PaymentAllocation" ADD COLUMN     "creditApplicationId" TEXT;

-- CreateTable
CREATE TABLE "CreditApplication" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "submissionKey" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreditApplication_submissionKey_key" ON "CreditApplication"("submissionKey");

-- CreateIndex
CREATE INDEX "CreditApplication_customerId_idx" ON "CreditApplication"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_submissionKey_key" ON "Payment"("submissionKey");

-- CreateIndex
CREATE INDEX "PaymentAllocation_paymentId_idx" ON "PaymentAllocation"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_creditApplicationId_idx" ON "PaymentAllocation"("creditApplicationId");

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_creditApplicationId_fkey" FOREIGN KEY ("creditApplicationId") REFERENCES "CreditApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditApplication" ADD CONSTRAINT "CreditApplication_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditApplication" ADD CONSTRAINT "CreditApplication_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ───────────── Payment allocation integrity ─────────────

ALTER TABLE "CreditApplication" ADD CONSTRAINT "CreditApplication_amount_positive" CHECK ("amount" > 0);
CREATE TRIGGER "CreditApplication_immutable" BEFORE UPDATE OR DELETE ON "CreditApplication" FOR EACH ROW EXECUTE FUNCTION stock_document_immutable();

-- A payment can only be allocated to an invoice of the SAME customer, and never beyond its own amount.
-- The payment row is locked first, so two simultaneous allocations of one payment cannot both squeeze through.
CREATE OR REPLACE FUNCTION payment_allocation_guard() RETURNS trigger AS $$
DECLARE
  p_amount numeric;
  p_customer text;
  s_customer text;
  already numeric;
BEGIN
  SELECT "amount", "customerId" INTO p_amount, p_customer FROM "Payment" WHERE "id" = NEW."paymentId" FOR UPDATE;
  SELECT "customerId" INTO s_customer FROM "Sale" WHERE "id" = NEW."saleId";
  IF p_customer IS DISTINCT FROM s_customer THEN
    RAISE EXCEPTION 'A payment can only be allocated to an invoice of the same customer';
  END IF;
  SELECT COALESCE(SUM("amount"), 0) INTO already FROM "PaymentAllocation" WHERE "paymentId" = NEW."paymentId";
  IF already + NEW."amount" > p_amount THEN
    RAISE EXCEPTION 'Allocations (%) would exceed the payment amount (%)', already + NEW."amount", p_amount;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PaymentAllocation_guard" BEFORE INSERT ON "PaymentAllocation" FOR EACH ROW EXECUTE FUNCTION payment_allocation_guard();

-- At COMMIT, every sale's "amountPaid" must equal the sum of the payments allocated to it.
-- (Deferred, so a transaction may insert the sale first and its allocation right after.)
CREATE OR REPLACE FUNCTION sale_allocation_consistent() RETURNS trigger AS $$
DECLARE
  sid text;
  paid numeric;
  allocated numeric;
BEGIN
  IF TG_TABLE_NAME = 'PaymentAllocation' THEN sid := NEW."saleId"; ELSE sid := NEW."id"; END IF;
  SELECT "amountPaid" INTO paid FROM "Sale" WHERE "id" = sid;
  SELECT COALESCE(SUM("amount"), 0) INTO allocated FROM "PaymentAllocation" WHERE "saleId" = sid;
  IF paid <> allocated THEN
    RAISE EXCEPTION 'Sale % is inconsistent: amountPaid % but payments allocated %', sid, paid, allocated;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "Sale_allocation_consistent"
  AFTER INSERT OR UPDATE ON "Sale" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION sale_allocation_consistent();
CREATE CONSTRAINT TRIGGER "PaymentAllocation_sale_consistent"
  AFTER INSERT ON "PaymentAllocation" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION sale_allocation_consistent();
