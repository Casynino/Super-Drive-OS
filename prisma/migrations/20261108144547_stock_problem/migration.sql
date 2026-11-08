-- CreateTable
CREATE TABLE "StockProblem" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "kind" "IssueKind" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "note" TEXT NOT NULL,
    "adjustmentId" TEXT NOT NULL,
    "submissionKey" TEXT NOT NULL,
    "reportedById" TEXT NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" "IssueAction",
    "decisionNote" TEXT,
    "foundAdjustmentId" TEXT,
    "discountPrice" DECIMAL(14,2),
    "variantProductId" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "StockProblem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockProblem_adjustmentId_key" ON "StockProblem"("adjustmentId");

-- CreateIndex
CREATE UNIQUE INDEX "StockProblem_submissionKey_key" ON "StockProblem"("submissionKey");

-- CreateIndex
CREATE UNIQUE INDEX "StockProblem_foundAdjustmentId_key" ON "StockProblem"("foundAdjustmentId");

-- CreateIndex
CREATE INDEX "StockProblem_reportedAt_idx" ON "StockProblem"("reportedAt");

-- CreateIndex
CREATE INDEX "StockProblem_action_idx" ON "StockProblem"("action");

-- CreateIndex
CREATE INDEX "StockProblem_productId_idx" ON "StockProblem"("productId");

-- AddForeignKey
ALTER TABLE "StockProblem" ADD CONSTRAINT "StockProblem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockProblem" ADD CONSTRAINT "StockProblem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockProblem" ADD CONSTRAINT "StockProblem_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "StockAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockProblem" ADD CONSTRAINT "StockProblem_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockProblem" ADD CONSTRAINT "StockProblem_foundAdjustmentId_fkey" FOREIGN KEY ("foundAdjustmentId") REFERENCES "StockAdjustment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockProblem" ADD CONSTRAINT "StockProblem_variantProductId_fkey" FOREIGN KEY ("variantProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockProblem" ADD CONSTRAINT "StockProblem_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Guards: a hand-reported problem is damaged or lost, never zero pieces, decided at most once, never deleted.
ALTER TABLE "StockProblem" ADD CONSTRAINT "StockProblem_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "StockProblem" ADD CONSTRAINT "StockProblem_kind_by_hand" CHECK ("kind" IN ('DAMAGED', 'MISSING'));
ALTER TABLE "StockProblem" ADD CONSTRAINT "StockProblem_decision_complete" CHECK (
  ("action" IS NULL AND "decidedById" IS NULL AND "decidedAt" IS NULL)
  OR ("action" IS NOT NULL AND "decidedById" IS NOT NULL AND "decidedAt" IS NOT NULL)
);

CREATE OR REPLACE FUNCTION stock_problem_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A reported problem is never deleted. Decide it instead.';
  END IF;
  IF OLD."action" IS NOT NULL THEN
    RAISE EXCEPTION 'This problem was already decided and cannot change.';
  END IF;
  IF NEW."productId" <> OLD."productId" OR NEW."locationId" <> OLD."locationId" OR NEW."kind" <> OLD."kind" OR NEW."quantity" <> OLD."quantity"
     OR NEW."note" <> OLD."note" OR NEW."adjustmentId" <> OLD."adjustmentId" OR NEW."reportedById" <> OLD."reportedById" OR NEW."reportedAt" <> OLD."reportedAt" THEN
    RAISE EXCEPTION 'What was reported cannot be changed.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "StockProblem_guard" BEFORE UPDATE OR DELETE ON "StockProblem" FOR EACH ROW EXECUTE FUNCTION stock_problem_guard();
