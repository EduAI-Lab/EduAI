-- a student number can now be stored before any Canvas roster corroborates
-- it, so that registration is not a dead end for students whose instructor has not
-- synced them yet. `studentIdVerifiedAt` records when a roster row carrying the
-- same verified email did corroborate it; enrollments are only created for
-- corroborated numbers.
ALTER TABLE "user" ADD COLUMN "studentIdVerifiedAt" TIMESTAMP(3);

-- Grandfather in the accounts that demonstrably passed the old check: a
-- Canvas-sourced enrollment is the artefact it left behind, so those keep
-- matching on the number alone and no existing enrollment is disturbed.
--
-- Scoped deliberately rather than stamping every row with a number. A blanket
-- backfill cannot be undone and would erase which stamps were actually earned,
-- and every row it touched would be one that skips the roster-email check
-- forever. An admin-set number with no enrollment yet is left unstamped: it
-- re-corroborates on the next roster email match or admin re-save, which is the
-- safe direction to be wrong in.
UPDATE "user" AS u
SET "studentIdVerifiedAt" = COALESCE(u."updatedAt", u."createdAt", CURRENT_TIMESTAMP)
WHERE u."studentId" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "enrollments" AS e
    WHERE e."userId" = u."id"
      AND e."externalSource" = 'canvas'
  );
