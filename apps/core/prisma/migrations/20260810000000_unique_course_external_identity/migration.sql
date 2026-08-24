-- A populated external identity must resolve to one Core course. PostgreSQL's
-- NULL-distinct uniqueness semantics leave manually-created/non-integrated
-- courses (whose externalSource or externalId is NULL) unaffected.
--
-- Deployment preflight: this intentionally fails without guessing how to merge
-- related enrollments, topics, materials, and questions when historical
-- duplicates exist. Resolve every row returned by the query in the exception
-- before retrying `prisma migrate deploy`.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "courses"
    WHERE "externalSource" IS NOT NULL
      AND "externalId" IS NOT NULL
    GROUP BY "externalSource", "externalId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Cannot enforce unique course external identity: duplicate (externalSource, externalId) rows exist',
      HINT = 'Run: SELECT "externalSource", "externalId", array_agg(id ORDER BY "createdAt") AS course_ids FROM "courses" WHERE "externalSource" IS NOT NULL AND "externalId" IS NOT NULL GROUP BY "externalSource", "externalId" HAVING COUNT(*) > 1; then merge or re-key each duplicate group and retry the migration.';
  END IF;
END $$;

CREATE UNIQUE INDEX "courses_externalSource_externalId_key"
ON "courses"("externalSource", "externalId");

DROP INDEX "courses_externalSource_externalId_idx";
