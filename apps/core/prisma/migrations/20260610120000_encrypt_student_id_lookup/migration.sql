-- Move uniqueness from encrypted studentId to deterministic lookup hash.
DROP INDEX IF EXISTS "user_studentId_key";

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "studentIdLookup" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "user_studentIdLookup_key" ON "user"("studentIdLookup");
