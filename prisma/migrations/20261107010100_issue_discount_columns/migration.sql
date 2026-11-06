-- What a discount decision remembers: the price per piece it was set at and the "damaged packaging" product the pieces now live in.
ALTER TABLE "ShipmentIssueDecision" ADD COLUMN "discountPrice" DECIMAL(14,2);
ALTER TABLE "ShipmentIssueDecision" ADD COLUMN "variantProductId" TEXT;
ALTER TABLE "ShipmentIssueDecision" ADD CONSTRAINT "ShipmentIssueDecision_variantProductId_fkey" FOREIGN KEY ("variantProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ShipmentIssueDecision" DROP CONSTRAINT "ShipmentIssueDecision_action_fits_kind";
ALTER TABLE "ShipmentIssueDecision" ADD CONSTRAINT "ShipmentIssueDecision_action_fits_kind" CHECK (
  ("kind" = 'MISSING' AND "action" IN ('FOUND', 'NOT_DELIVERED')) OR
  ("kind" = 'DAMAGED' AND "action" IN ('WRITE_OFF', 'DISCOUNT_SELL')) OR
  ("kind" = 'EXTRA' AND "action" = 'KEEP')
);
-- a discount decision always carries its price and its product
ALTER TABLE "ShipmentIssueDecision" ADD CONSTRAINT "ShipmentIssueDecision_discount_has_price" CHECK ("action" <> 'DISCOUNT_SELL' OR ("discountPrice" IS NOT NULL AND "discountPrice" > 0 AND "variantProductId" IS NOT NULL));
