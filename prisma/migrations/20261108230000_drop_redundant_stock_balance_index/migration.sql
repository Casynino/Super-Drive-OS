-- The primary key of StockBalance is (productId, locationId), so productId is already indexed; the extra index added by foreign_key_indexes was redundant.
DROP INDEX IF EXISTS "StockBalance_productId_idx";
