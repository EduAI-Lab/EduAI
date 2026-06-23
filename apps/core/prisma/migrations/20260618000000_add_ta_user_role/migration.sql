-- AlterEnum
-- Backfills the 'TA' value onto the UserRole enum for databases provisioned
-- before 'TA' was folded into the schema_unification CREATE TYPE. Fresh
-- databases already have it (the CREATE lists TA), so this is a no-op there.
-- Mirrors the idempotent guard used by 20260604002902_add_unit_admin.
DO $$ BEGIN
  ALTER TYPE "UserRole" ADD VALUE 'TA';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
