-- Reset the business data and keep the set-up (Nino 2026-11-10: "reset all the data, keep the products and their pictures,
-- let the boss start from the beginning").
--
-- KEPT:    users, roles and permissions, sessions, settings, the default location, units, categories, brands, products with their
--          cartons (ProductUnit) and pictures, the cash accounts (names and numbers only), expense categories, the product-barcode counter.
-- CLEARED: every stock, sale, payment, credit, return, shipment, closing, cash, expense, Winga, customer and supplier record, the
--          audit log, the activity log, notifications and every document counter (so the first invoice is INV-2026-000001 again).
--          Product average cost goes back to 0 (no stock = no cost). With -v clear_prices=1 the placeholder prices are cleared too.
--
-- Run on ONE database at a time, after a backup (pg_dump), in one transaction (-1): either everything is cleared or nothing is.
--   psql "$URL" -v ON_ERROR_STOP=1 -1 -v clear_prices=0 -f scripts/reset-business-data.sql
-- Never run it by accident: it asks for nothing, so the connection string you pass IS the confirmation.

\if :{?clear_prices}
\else
  \set clear_prices 0
\endif

\echo '--- BEFORE (rows per table)'
SELECT table_name AS "table",
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I', table_name), false, true, '')))[1]::text::int AS rows
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'
ORDER BY 1;

-- the "history is read-only" guards (triggers) are switched off for this one transaction, on the tables that are cleared
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'AuditLog','ActivityLog','Notification',
    'WarehouseEvent','PickupReleaseItem','PickupRelease','PickupNoteItem','PickupNote',
    'ItemMovement','InventoryItem','StockProblem',
    'ShipmentIssueDecision','ShipmentReceivingItem','ShipmentReceiving','ShipmentItem','Shipment',
    'SupplierPayment','Supplier',
    'ResellerReturnItem','ResellerReturn','ResellerIssueItem','ResellerIssue','Reseller',
    'PaymentReminder','WhatsAppReport',
    'ReversalItem','SaleReversal','CreditApplication','PaymentAllocation','Payment','SaleItem','Sale','Customer',
    'BankDeposit','DailyClosing','Expense','CashTransaction','Attachment',
    'StockTransferItem','StockTransfer','StockAdjustmentItem','StockAdjustment','StockReceiptItem','StockReceipt','StockMovement','StockBalance',
    'Location','CashAccount','ProductPriceHistory','ProductUnit','Product','DocumentCounter'
  ] LOOP
    EXECUTE format('ALTER TABLE %I DISABLE TRIGGER USER', t);
  END LOOP;
END $$;

-- 1. the business records (one statement: every table that points at another one in the list is in the list)
TRUNCATE TABLE
  "AuditLog", "ActivityLog", "Notification",
  "WarehouseEvent", "PickupReleaseItem", "PickupRelease", "PickupNoteItem", "PickupNote",
  "ItemMovement", "InventoryItem", "StockProblem",
  "ShipmentIssueDecision", "ShipmentReceivingItem", "ShipmentReceiving", "ShipmentItem", "Shipment",
  "SupplierPayment", "Supplier",
  "ResellerReturnItem", "ResellerReturn", "ResellerIssueItem", "ResellerIssue", "Reseller",
  "PaymentReminder", "WhatsAppReport",
  "ReversalItem", "SaleReversal", "CreditApplication", "PaymentAllocation", "Payment", "SaleItem", "Sale", "Customer",
  "BankDeposit", "DailyClosing", "Expense", "CashTransaction", "Attachment",
  "StockTransferItem", "StockTransfer", "StockAdjustmentItem", "StockAdjustment", "StockReceiptItem", "StockReceipt", "StockMovement", "StockBalance"
  RESTART IDENTITY;

-- 2. a Winga's custody place goes with the Winga (the shop's own location stays)
DELETE FROM "CashAccount" WHERE "locationId" IN (SELECT id FROM "Location" WHERE type = 'RESELLER');
DELETE FROM "Location" WHERE type = 'RESELLER';

-- 3. numbering starts again; the product-barcode counter stays (the kept products already own their barcodes)
DELETE FROM "DocumentCounter" WHERE key <> 'PRODUCT-BARCODE';

-- 4. products: no stock means no cost; the placeholder prices only when asked
UPDATE "Product" SET "avgCost" = 0;
\if :clear_prices
  UPDATE "Product" SET "purchasePrice" = 0, "sellingPrice" = 0, "wholesalePrice" = NULL;
  UPDATE "ProductUnit" SET "sellingPrice" = NULL, "wholesalePrice" = NULL;
  DELETE FROM "ProductPriceHistory";
\endif

-- 5. one line in the (new, empty) audit log, so the reset itself is on record
INSERT INTO "AuditLog" (id, "userName", action, "entityType", reason, "createdAt")
VALUES ('reset-' || to_char(now(), 'YYYYMMDDHH24MISS'), 'System', 'system.business_data_reset', 'System',
        'Business data cleared on the owner''s instruction; products, pictures, staff, roles and settings kept', now());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'AuditLog','ActivityLog','Notification',
    'WarehouseEvent','PickupReleaseItem','PickupRelease','PickupNoteItem','PickupNote',
    'ItemMovement','InventoryItem','StockProblem',
    'ShipmentIssueDecision','ShipmentReceivingItem','ShipmentReceiving','ShipmentItem','Shipment',
    'SupplierPayment','Supplier',
    'ResellerReturnItem','ResellerReturn','ResellerIssueItem','ResellerIssue','Reseller',
    'PaymentReminder','WhatsAppReport',
    'ReversalItem','SaleReversal','CreditApplication','PaymentAllocation','Payment','SaleItem','Sale','Customer',
    'BankDeposit','DailyClosing','Expense','CashTransaction','Attachment',
    'StockTransferItem','StockTransfer','StockAdjustmentItem','StockAdjustment','StockReceiptItem','StockReceipt','StockMovement','StockBalance',
    'Location','CashAccount','ProductPriceHistory','ProductUnit','Product','DocumentCounter'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE TRIGGER USER', t);
  END LOOP;
END $$;

\echo '--- AFTER (rows per table)'
SELECT table_name AS "table",
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I', table_name), false, true, '')))[1]::text::int AS rows
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'
ORDER BY 1;
