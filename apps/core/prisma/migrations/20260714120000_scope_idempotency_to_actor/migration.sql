-- Scope idempotency to (key, route, actorId). Preserve legacy question backfills;
-- do not wipe the table (that would undo the entity-key migration).

ALTER TABLE "idempotency_records"
ADD COLUMN "actorId" TEXT;

UPDATE "idempotency_records"
SET "actorId" = "responseBody"->>'createdBy'
WHERE "actorId" IS NULL
  AND "responseBody"->>'createdBy' IS NOT NULL;

-- Rows that cannot be attributed safely cannot be replayed under actor scoping.
DELETE FROM "idempotency_records"
WHERE "actorId" IS NULL;

ALTER TABLE "idempotency_records"
ALTER COLUMN "actorId" SET NOT NULL;

-- Strip migration-only attribution so replay matches POST /api/questions `{ id }`.
UPDATE "idempotency_records"
SET "responseBody" = jsonb_build_object('id', "responseBody"->>'id')
WHERE "requestHash" = 'legacy-entity-backfill'
  AND "route" = 'POST /api/questions'
  AND "responseBody" ? 'id';

DROP INDEX IF EXISTS "idempotency_records_key_route_key";

CREATE UNIQUE INDEX "idempotency_records_key_route_actorId_key"
ON "idempotency_records"("key", "route", "actorId");
