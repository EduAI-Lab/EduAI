-- Encrypt roster sis_user_id matching via HMAC lookup (mirrors User.studentIdLookup).

ALTER TABLE "canvas_roster_members" ADD COLUMN IF NOT EXISTS "sisUserIdLookup" TEXT;

CREATE INDEX IF NOT EXISTS "canvas_roster_members_sisUserIdLookup_idx"
  ON "canvas_roster_members"("sisUserIdLookup");

DROP INDEX IF EXISTS "canvas_roster_members_sisUserId_idx";
