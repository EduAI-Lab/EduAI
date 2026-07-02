-- AlterTable: track when each credential account's password was last set (#339 annual rotation)
-- NULL means the account predates this migration; expiry is not enforced until
-- the user next changes their password, which will stamp the timestamp.
ALTER TABLE "account" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
