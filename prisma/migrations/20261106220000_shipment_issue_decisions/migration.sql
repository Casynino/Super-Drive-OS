-- Decisions about the problem products of a received shipment (missing / damaged / extra). Additive: no existing row is touched.
CREATE TYPE "IssueKind" AS ENUM ('MISSING', 'DAMAGED', 'EXTRA');
CREATE TYPE "IssueAction" AS ENUM ('FOUND', 'NOT_DELIVERED', 'WRITE_OFF', 'KEEP');

CREATE TABLE "ShipmentIssueDecision" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "shipmentItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "kind" "IssueKind" NOT NULL,
    "action" "IssueAction" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "note" TEXT,
    "stockReceiptId" TEXT,
    "movedToShipmentId" TEXT,
    "submissionKey" TEXT NOT NULL,
    "decidedById" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentIssueDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShipmentIssueDecision_submissionKey_key" ON "ShipmentIssueDecision"("submissionKey");
CREATE INDEX "ShipmentIssueDecision_shipmentId_idx" ON "ShipmentIssueDecision"("shipmentId");
CREATE INDEX "ShipmentIssueDecision_shipmentItemId_idx" ON "ShipmentIssueDecision"("shipmentItemId");

ALTER TABLE "ShipmentIssueDecision" ADD CONSTRAINT "ShipmentIssueDecision_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShipmentIssueDecision" ADD CONSTRAINT "ShipmentIssueDecision_shipmentItemId_fkey" FOREIGN KEY ("shipmentItemId") REFERENCES "ShipmentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShipmentIssueDecision" ADD CONSTRAINT "ShipmentIssueDecision_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShipmentIssueDecision" ADD CONSTRAINT "ShipmentIssueDecision_stockReceiptId_fkey" FOREIGN KEY ("stockReceiptId") REFERENCES "StockReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ShipmentIssueDecision" ADD CONSTRAINT "ShipmentIssueDecision_movedToShipmentId_fkey" FOREIGN KEY ("movedToShipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ShipmentIssueDecision" ADD CONSTRAINT "ShipmentIssueDecision_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Guards: a positive quantity, and only the actions that make sense for the kind of problem.
ALTER TABLE "ShipmentIssueDecision" ADD CONSTRAINT "ShipmentIssueDecision_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "ShipmentIssueDecision" ADD CONSTRAINT "ShipmentIssueDecision_action_fits_kind" CHECK (
  ("kind" = 'MISSING' AND "action" IN ('FOUND', 'NOT_DELIVERED')) OR
  ("kind" = 'DAMAGED' AND "action" = 'WRITE_OFF') OR
  ("kind" = 'EXTRA' AND "action" = 'KEEP')
);

-- A decision is never edited or deleted (like the audit log): a wrong one is answered by what happens next, not by rewriting history.
CREATE OR REPLACE FUNCTION shipment_issue_decision_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Investigation decisions cannot be changed or deleted';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ShipmentIssueDecision_guard" BEFORE UPDATE OR DELETE ON "ShipmentIssueDecision" FOR EACH ROW EXECUTE FUNCTION shipment_issue_decision_guard();
