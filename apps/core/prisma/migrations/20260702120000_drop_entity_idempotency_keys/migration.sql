-- #828 phase 3: move question entity-column idempotency keys into IdempotencyRecord, then drop columns.
-- Backfill first so upgrades keep retry-safe creates (e.g. QM `qm-variant-*` keys).

-- Sentinel requestHash: original request bodies are not recoverable from entity rows.
-- claimIdempotency treats this hash as "replay any body for this key" (see LEGACY_ENTITY_BACKFILL_HASH).
-- responseBody.createdBy is temporary attribution for the later actorId migration; stripped there.
INSERT INTO "idempotency_records" (
  "id",
  "key",
  "route",
  "requestHash",
  "status",
  "statusCode",
  "responseBody",
  "expiresAt",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  q."idempotencyKey",
  'POST /api/questions',
  'legacy-entity-backfill',
  'COMPLETED'::"IdempotencyStatus",
  201,
  jsonb_build_object('id', q.id, 'createdBy', q."createdBy"),
  NOW() + INTERVAL '365 days',
  NOW(),
  NOW()
FROM "questions" q
WHERE q."idempotencyKey" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "idempotency_records" r
    WHERE r."key" = q."idempotencyKey"
      AND r."route" = 'POST /api/questions'
  );

DROP INDEX IF EXISTS "enrollments_idempotencyKey_key";
ALTER TABLE "enrollments" DROP COLUMN IF EXISTS "idempotencyKey";

DROP INDEX IF EXISTS "questions_idempotencyKey_key";
ALTER TABLE "questions" DROP COLUMN IF EXISTS "idempotencyKey";
