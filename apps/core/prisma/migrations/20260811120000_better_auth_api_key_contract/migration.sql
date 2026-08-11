-- Align the persisted API-key table with @better-auth/api-key 1.6.22.
--
-- The original table was created from an older plugin contract (`userId` and
-- JSONB metadata/permissions). Better Auth 1.6.x uses `referenceId`, a
-- required `configId`, and string-encoded metadata/permissions. Rename and
-- cast in place so existing key hashes and ownership survive unchanged.

ALTER TABLE "apiKey" DROP CONSTRAINT IF EXISTS "apiKey_userId_fkey";
DROP INDEX IF EXISTS "apiKey_userId_idx";

ALTER TABLE "apiKey" RENAME COLUMN "userId" TO "referenceId";

ALTER TABLE "apiKey"
  ADD COLUMN "configId" TEXT NOT NULL DEFAULT 'default';

ALTER TABLE "apiKey"
  ALTER COLUMN "metadata" TYPE TEXT
    USING CASE WHEN "metadata" IS NULL THEN NULL ELSE "metadata"::text END,
  ALTER COLUMN "permissions" TYPE TEXT
    USING CASE WHEN "permissions" IS NULL THEN NULL ELSE "permissions"::text END;

ALTER TABLE "apiKey"
  ALTER COLUMN "rateLimitEnabled" SET DEFAULT true,
  ALTER COLUMN "rateLimitTimeWindow" SET DEFAULT 86400000,
  ALTER COLUMN "rateLimitMax" SET DEFAULT 10;

CREATE INDEX "apiKey_configId_idx" ON "apiKey"("configId");
CREATE INDEX "apiKey_referenceId_idx" ON "apiKey"("referenceId");
CREATE INDEX "apiKey_key_idx" ON "apiKey"("key");

ALTER TABLE "apiKey"
  ADD CONSTRAINT "apiKey_referenceId_fkey"
  FOREIGN KEY ("referenceId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
