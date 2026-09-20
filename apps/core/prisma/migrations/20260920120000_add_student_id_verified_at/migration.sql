-- a student number can now be stored before any Canvas roster corroborates
-- it, so that registration is not a dead end for students whose instructor has not
-- synced them yet. `studentIdVerifiedAt` records when a roster row carrying the
-- same verified email did corroborate it; enrollments are only created for
-- corroborated numbers.
ALTER TABLE "user" ADD COLUMN "studentIdVerifiedAt" TIMESTAMP(3);

-- Every student number already stored was either set by an administrator or
-- passed the old self-service roster+email check, so grandfather them in rather
-- than stripping enrollments from existing accounts on deploy.
UPDATE "user"
SET "studentIdVerifiedAt" = COALESCE("updatedAt", "createdAt", CURRENT_TIMESTAMP)
WHERE "studentId" IS NOT NULL;
