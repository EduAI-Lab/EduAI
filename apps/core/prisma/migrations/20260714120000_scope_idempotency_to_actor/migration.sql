-- Existing records predate actor scoping and cannot be safely replayed.
DELETE FROM "idempotency_records";

ALTER TABLE "idempotency_records"
ADD COLUMN "actorId" TEXT NOT NULL;

DROP INDEX "idempotency_records_key_route_key";

CREATE UNIQUE INDEX "idempotency_records_key_route_actorId_key"
ON "idempotency_records"("key", "route", "actorId");
