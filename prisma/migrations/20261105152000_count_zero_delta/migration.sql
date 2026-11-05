-- A stock count line may match the system quantity exactly (delta = 0); it is still recorded as counted.
ALTER TABLE "StockAdjustmentItem" DROP CONSTRAINT "StockAdjustmentItem_amounts_valid";
ALTER TABLE "StockAdjustmentItem" ADD CONSTRAINT "StockAdjustmentItem_amounts_valid" CHECK ("enteredQty" >= 0 AND "factor" > 0 AND "systemQty" >= 0);
