-- Damaged goods a customer brought back become a problem the warehouse decides about (found / write off / sell at a discount), like a hand-reported one.
-- A problem now comes from EXACTLY ONE source: a stock adjustment (reported by hand) or a damaged return line.

-- DropForeignKey
ALTER TABLE "StockProblem" DROP CONSTRAINT "StockProblem_adjustmentId_fkey";

-- AlterTable
ALTER TABLE "StockProblem" ADD COLUMN "reversalItemId" TEXT,
ALTER COLUMN "adjustmentId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "StockProblem_reversalItemId_key" ON "StockProblem"("reversalItemId");

-- AddForeignKey
ALTER TABLE "StockProblem" ADD CONSTRAINT "StockProblem_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "StockAdjustment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockProblem" ADD CONSTRAINT "StockProblem_reversalItemId_fkey" FOREIGN KEY ("reversalItemId") REFERENCES "ReversalItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StockProblem" ADD CONSTRAINT "StockProblem_one_source" CHECK (("adjustmentId" IS NOT NULL) <> ("reversalItemId" IS NOT NULL));

-- The guard also keeps the source fixed (NULL-safe).
CREATE OR REPLACE FUNCTION stock_problem_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A reported problem is never deleted. Decide it instead.';
  END IF;
  IF OLD."action" IS NOT NULL THEN
    RAISE EXCEPTION 'This problem was already decided and cannot change.';
  END IF;
  IF NEW."productId" <> OLD."productId" OR NEW."locationId" <> OLD."locationId" OR NEW."kind" <> OLD."kind" OR NEW."quantity" <> OLD."quantity"
     OR NEW."note" <> OLD."note" OR NEW."adjustmentId" IS DISTINCT FROM OLD."adjustmentId" OR NEW."reversalItemId" IS DISTINCT FROM OLD."reversalItemId"
     OR NEW."reportedById" <> OLD."reportedById" OR NEW."reportedAt" <> OLD."reportedAt" THEN
    RAISE EXCEPTION 'What was reported cannot be changed.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Damaged returns that already happened: one open problem per damaged line, for the pieces that really came back (from the stock ledger).
INSERT INTO "StockProblem" ("id", "productId", "locationId", "kind", "quantity", "note", "reversalItemId", "submissionKey", "reportedById", "reportedAt")
SELECT 'cret' || md5(x."itemId"), x."productId", x."locationId", 'DAMAGED', LEAST(x."lineQty", x."moved"), x."reason", x."itemId", 'return:' || x."itemId", x."requestedById", x."at"
  FROM (
    SELECT ri."id" AS "itemId", ri."productId", s."locationId", ri."quantity" AS "lineQty", r."reason", r."requestedById", COALESCE(r."decidedAt", r."requestedAt") AS "at",
           (SELECT COALESCE(-SUM(m."quantity"), 0) FROM "StockMovement" m
             WHERE m."referenceType" = 'SaleReversal' AND m."referenceId" = r."id" AND m."productId" = ri."productId" AND m."type" = 'DAMAGED') AS "moved"
      FROM "ReversalItem" ri
      JOIN "SaleReversal" r ON r."id" = ri."reversalId"
      JOIN "Sale" s ON s."id" = r."saleId"
     WHERE ri."condition" = 'DAMAGED' AND r."status" = 'COMPLETED'
  ) x
 WHERE x."moved" > 0
ON CONFLICT DO NOTHING;
