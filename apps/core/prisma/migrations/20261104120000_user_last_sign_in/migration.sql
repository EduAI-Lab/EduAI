-- Admin dashboard "Accounts that never signed in": stamped by the better-auth
-- session.create hook on every sign-in. Sessions are deleted on sign-out, so
-- the backfill below only recovers users who still hold one; everyone else
-- stays null until their next sign-in.
ALTER TABLE "user" ADD COLUMN "lastSignInAt" TIMESTAMP(3);

UPDATE "user" u
SET "lastSignInAt" = s.latest
FROM (SELECT "userId", MAX("createdAt") AS latest FROM "session" GROUP BY "userId") s
WHERE s."userId" = u.id;
