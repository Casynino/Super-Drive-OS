ALTER TABLE "ShipmentIssueDecision" DROP CONSTRAINT "ShipmentIssueDecision_action_fits_kind";
ALTER TABLE "ShipmentIssueDecision" ADD CONSTRAINT "ShipmentIssueDecision_action_fits_kind" CHECK (
  "action" = 'DISMISS' OR
  ("kind" = 'MISSING' AND "action" IN ('FOUND', 'NOT_DELIVERED')) OR
  ("kind" = 'DAMAGED' AND "action" IN ('WRITE_OFF', 'DISCOUNT_SELL')) OR
  ("kind" = 'EXTRA' AND "action" = 'KEEP')
);
-- removing from the list always needs a reason, so the history says why
ALTER TABLE "ShipmentIssueDecision" ADD CONSTRAINT "ShipmentIssueDecision_dismiss_has_reason" CHECK ("action" <> 'DISMISS' OR length(btrim(coalesce("note", ''))) >= 3);
