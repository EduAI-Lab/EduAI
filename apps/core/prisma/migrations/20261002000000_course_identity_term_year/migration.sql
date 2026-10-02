-- #1811: course identity is code + section + year + term (was startDate). Still partial on
-- deletedAt; not expressible in schema.prisma, so globalSetup.ts re-applies it.

-- Preflight: refuse to build over live rows that only differed by start date.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "courses"
    WHERE "deletedAt" IS NULL
    GROUP BY "code", "section", "year", "term"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Cannot enforce the course identity index: duplicate live (code, section, year, term) rows exist',
      HINT = 'Run: SELECT "code", "section", "year", "term", array_agg(id ORDER BY "createdAt") AS course_ids FROM "courses" WHERE "deletedAt" IS NULL GROUP BY "code", "section", "year", "term" HAVING COUNT(*) > 1; then merge or soft-delete each duplicate group and retry the migration.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "courses_code_section_year_term_active_key"
ON "courses"("code", "section", "year", "term")
WHERE "deletedAt" IS NULL;

DROP INDEX IF EXISTS "courses_code_startDate_section_active_key";
