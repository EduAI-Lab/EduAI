-- Drop Better Auth tables created by the pre-unification schema.
-- These tables (user, session, account, verification) are no longer needed
-- because AI Tutor now validates sessions via Core's POST /api/sessions/validate.

DROP TABLE IF EXISTS "public"."verification" CASCADE;
DROP TABLE IF EXISTS "public"."account" CASCADE;
DROP TABLE IF EXISTS "public"."session" CASCADE;
DROP TABLE IF EXISTS "public"."user" CASCADE;
