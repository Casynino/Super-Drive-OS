-- Separate migration: a new enum value cannot be used in the transaction that adds it
-- a supplier payment is always money going out
ALTER TABLE "CashTransaction" DROP CONSTRAINT "CashTransaction_sign_matches_type";
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_sign_matches_type" CHECK (
  CASE "type"
    WHEN 'SALE_PAYMENT' THEN "amount" > 0
    WHEN 'COLLECTION' THEN "amount" > 0
    WHEN 'DEPOSIT_IN' THEN "amount" > 0
    WHEN 'EXPENSE_REVERSAL' THEN "amount" > 0
    WHEN 'OPENING_BALANCE' THEN "amount" > 0
    WHEN 'REFUND' THEN "amount" < 0
    WHEN 'EXPENSE' THEN "amount" < 0
    WHEN 'DEPOSIT_OUT' THEN "amount" < 0
    WHEN 'WITHDRAWAL' THEN "amount" < 0
    WHEN 'SUPPLIER_PAYMENT' THEN "amount" < 0
    ELSE TRUE
  END
);
