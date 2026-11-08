-- Indexes on foreign keys that are searched or joined often (additive only: nothing is changed or removed).
-- CreateIndex
CREATE INDEX "CashTransaction_closingId_idx" ON "CashTransaction"("closingId");
-- CreateIndex
CREATE INDEX "CashTransaction_userId_idx" ON "CashTransaction"("userId");
-- CreateIndex
CREATE INDEX "DailyClosing_submittedById_idx" ON "DailyClosing"("submittedById");
-- CreateIndex
CREATE INDEX "Expense_categoryId_idx" ON "Expense"("categoryId");
-- CreateIndex
CREATE INDEX "Expense_cashAccountId_idx" ON "Expense"("cashAccountId");
-- CreateIndex
CREATE INDEX "Expense_locationId_idx" ON "Expense"("locationId");
-- CreateIndex
CREATE INDEX "InventoryItem_locationId_idx" ON "InventoryItem"("locationId");
-- CreateIndex
CREATE INDEX "Payment_receivedById_idx" ON "Payment"("receivedById");
-- CreateIndex
CREATE INDEX "PickupNote_createdById_idx" ON "PickupNote"("createdById");
-- CreateIndex
CREATE INDEX "PickupNote_completedById_idx" ON "PickupNote"("completedById");
-- CreateIndex
CREATE INDEX "PickupReleaseItem_productId_idx" ON "PickupReleaseItem"("productId");
-- CreateIndex
CREATE INDEX "ResellerIssue_fromLocationId_idx" ON "ResellerIssue"("fromLocationId");
-- CreateIndex
CREATE INDEX "ResellerIssue_toLocationId_idx" ON "ResellerIssue"("toLocationId");
-- CreateIndex
CREATE INDEX "ResellerReturn_fromLocationId_idx" ON "ResellerReturn"("fromLocationId");
-- CreateIndex
CREATE INDEX "ResellerReturn_toLocationId_idx" ON "ResellerReturn"("toLocationId");
-- CreateIndex
CREATE INDEX "ReversalItem_productId_idx" ON "ReversalItem"("productId");
-- CreateIndex
CREATE INDEX "SaleReversal_requestedById_idx" ON "SaleReversal"("requestedById");
-- CreateIndex
CREATE INDEX "Shipment_supplierId_idx" ON "Shipment"("supplierId");
-- CreateIndex
CREATE INDEX "Shipment_locationId_idx" ON "Shipment"("locationId");
-- CreateIndex
CREATE INDEX "ShipmentReceivingItem_productId_idx" ON "ShipmentReceivingItem"("productId");
-- CreateIndex
CREATE INDEX "StockAdjustment_locationId_idx" ON "StockAdjustment"("locationId");
-- CreateIndex
CREATE INDEX "StockBalance_productId_idx" ON "StockBalance"("productId");
-- CreateIndex
CREATE INDEX "StockMovement_locationId_idx" ON "StockMovement"("locationId");
-- CreateIndex
CREATE INDEX "StockMovement_userId_idx" ON "StockMovement"("userId");
-- CreateIndex
CREATE INDEX "StockProblem_locationId_idx" ON "StockProblem"("locationId");
-- CreateIndex
CREATE INDEX "StockReceipt_locationId_idx" ON "StockReceipt"("locationId");
-- CreateIndex
CREATE INDEX "StockTransfer_fromLocationId_idx" ON "StockTransfer"("fromLocationId");
-- CreateIndex
CREATE INDEX "StockTransfer_toLocationId_idx" ON "StockTransfer"("toLocationId");
-- CreateIndex
CREATE INDEX "SupplierPayment_shipmentId_idx" ON "SupplierPayment"("shipmentId");
-- CreateIndex
CREATE INDEX "WarehouseEvent_productId_idx" ON "WarehouseEvent"("productId");
-- CreateIndex
CREATE INDEX "WarehouseEvent_locationId_idx" ON "WarehouseEvent"("locationId");
