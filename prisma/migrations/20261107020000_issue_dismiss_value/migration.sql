-- "Remove from the list": the owner can close a problem record without changing stock or money (a reason is required). Its own migration because a new enum value cannot be used in the transaction that adds it.
ALTER TYPE "IssueAction" ADD VALUE IF NOT EXISTS 'DISMISS';
