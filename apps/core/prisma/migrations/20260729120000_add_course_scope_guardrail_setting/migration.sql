-- Defaulted off (was on) for easier testing
ALTER TABLE "courses"
ADD COLUMN "courseScopeGuardrailEnabled" BOOLEAN NOT NULL DEFAULT false;
