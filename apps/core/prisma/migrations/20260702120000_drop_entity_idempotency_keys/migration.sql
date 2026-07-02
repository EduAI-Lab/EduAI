-- Drop entity-column idempotency keys (#828 phase 3) — centralized IdempotencyRecord store replaces these.
DROP INDEX IF EXISTS "enrollments_idempotencyKey_key";
ALTER TABLE "enrollments" DROP COLUMN IF EXISTS "idempotencyKey";

DROP INDEX IF EXISTS "questions_idempotencyKey_key";
ALTER TABLE "questions" DROP COLUMN IF EXISTS "idempotencyKey";
