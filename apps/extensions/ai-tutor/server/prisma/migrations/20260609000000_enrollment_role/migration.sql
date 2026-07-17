-- Add role column to CourseEnrollment to mirror Core's EnrollmentRole.
-- Existing rows default to STUDENT, which is safe because the sync will update
-- any TA or INSTRUCTOR rows on the next run.

ALTER TABLE "public"."CourseEnrollment" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'STUDENT';
