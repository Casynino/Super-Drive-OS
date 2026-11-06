-- Damaged cartons can be sold at a discount: a new decision value (its own migration, because a new enum value cannot be used in the transaction that adds it).
ALTER TYPE "IssueAction" ADD VALUE IF NOT EXISTS 'DISCOUNT_SELL';
