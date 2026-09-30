-- #1842 — free the course identity slot when a course is soft-deleted.
--
-- `deleteCourse` only sets `deletedAt`, but the (code, startDate, section)
-- unique index had no `deletedAt` predicate, so a tombstone owned that identity
-- forever. Re-creating the same course afterwards hit a P2002 that
-- `createCourse` did not handle, surfacing as an unexplained failure.
--
-- Replacing it with a partial unique index keeps every live-row guarantee
-- intact while letting tombstones accumulate outside the constraint. Prisma
-- cannot express a `WHERE` predicate on a unique index, so this index is not
-- declared in schema.prisma; see the comment on `model Course` there, and
-- app/tests/globalSetup.ts which re-applies it to `db push`-provisioned
-- integration databases.
--
-- Deliberately NOT applied to (externalSource, externalId): that index stays
-- total because `upsertCoreCourseFromCanvas` upserts on it and clears
-- `deletedAt`, so a re-imported Canvas course is restored in place with its
-- materials, chunks and embeddings. A partial index there would hide the
-- tombstone from the upsert and fork a second, empty course instead.

-- Deployment preflight: two or more LIVE rows already sharing an identity would
-- make the new index unbuildable. That cannot happen while the old total index
-- is in force, but the check is cheap and keeps a hand-edited database honest.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "courses"
    WHERE "deletedAt" IS NULL
    GROUP BY "code", "startDate", "section"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Cannot enforce the partial course identity index: duplicate live (code, startDate, section) rows exist',
      HINT = 'Run: SELECT "code", "startDate", "section", array_agg(id ORDER BY "createdAt") AS course_ids FROM "courses" WHERE "deletedAt" IS NULL GROUP BY "code", "startDate", "section" HAVING COUNT(*) > 1; then merge or soft-delete each duplicate group and retry the migration.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "courses_code_startDate_section_active_key"
ON "courses"("code", "startDate", "section")
WHERE "deletedAt" IS NULL;

DROP INDEX IF EXISTS "courses_code_startDate_section_key";
