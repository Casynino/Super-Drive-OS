-- Staff sign in with their EMAIL address (Nino 2026-11-08). The username column stays as an internal handle.
-- 1. normalise the emails that already exist
UPDATE "User" SET "email" = lower(btrim("email")) WHERE "email" IS NOT NULL;
-- 2. accounts that never had an email get a clearly fake one (<username>@superdrive.local) so they can still sign in;
--    the Director replaces it with the person's real email (Employees, or My profile).
UPDATE "User" SET "email" = lower("username") || '@superdrive.local' WHERE "email" IS NULL;
-- 3. every account must have a unique, lowercase email from now on
ALTER TABLE "User" ALTER COLUMN "email" SET NOT NULL;
ALTER TABLE "User" ADD CONSTRAINT "User_email_lowercase_chk" CHECK ("email" = lower("email"));
