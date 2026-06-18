-- Unify TA representation onto Enrollment(role=TA) and add one-way soft-delete
-- markers to course materials/topics.
--
-- TA was previously modelled three ways: the platform-level UserRole.TA enum
-- value, the standalone course_tas junction table, and Enrollment.role = 'TA'.
-- A TA is now simply a STUDENT-platform user holding an Enrollment with role TA
-- for a specific course. This migration backfills, then drops the legacy shapes.

-- 1. Backfill: every course_tas row becomes an active TA enrollment. Existing
--    enrollments are promoted to TA (the app already dual-writes, so most exist).
INSERT INTO "enrollments" ("id", "courseId", "userId", "role", "enrolledAt", "updatedAt", "isActive")
SELECT
  gen_random_uuid()::text,
  ct."courseId",
  ct."userId",
  'TA'::"EnrollmentRole",
  ct."createdAt",
  now(),
  true
FROM "course_tas" ct
ON CONFLICT ("courseId", "userId")
DO UPDATE SET "role" = 'TA'::"EnrollmentRole", "isActive" = true, "updatedAt" = now();

-- 2. Demote legacy platform-level TA users to STUDENT (their course-level TA
--    status now lives entirely in enrollments). Defensive: also covers any
--    invitations that somehow carried role TA.
UPDATE "user" SET "role" = 'STUDENT'::"UserRole" WHERE "role" = 'TA'::"UserRole";
UPDATE "invitations" SET "role" = 'STUDENT'::"UserRole" WHERE "role" = 'TA'::"UserRole";

-- 3. Drop the legacy junction table.
DROP TABLE "course_tas";

-- 4. Remove the TA value from the UserRole enum by recreating it. Both columns
--    that reference it (user.role, invitations.role) are re-typed in place.
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'UNIT_ADMIN', 'INSTRUCTOR', 'STUDENT');
ALTER TABLE "user" ALTER COLUMN "role" TYPE "UserRole" USING ("role"::text::"UserRole");
ALTER TABLE "invitations" ALTER COLUMN "role" TYPE "UserRole" USING ("role"::text::"UserRole");
DROP TYPE "UserRole_old";

-- 5. One-way soft-delete markers. course_topics already has deletedAt; add the
--    owner column and a filtered-read index. course_materials gets both columns.
ALTER TABLE "course_materials" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "course_materials" ADD COLUMN "deletedBy" TEXT;
CREATE INDEX "course_materials_courseId_deletedAt_idx" ON "course_materials" ("courseId", "deletedAt");

ALTER TABLE "course_topics" ADD COLUMN "deletedBy" TEXT;
CREATE INDEX "course_topics_courseId_deletedAt_idx" ON "course_topics" ("courseId", "deletedAt");
