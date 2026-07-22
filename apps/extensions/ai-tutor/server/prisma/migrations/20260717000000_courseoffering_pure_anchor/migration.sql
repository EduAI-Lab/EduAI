-- #1072 step 4: CourseOffering becomes a pure anchor row (id, coreOfferingId,
-- timestamps). Core now owns every real course field (title/description/
-- department/dates/isPublished/external-link metadata) via the step 2/3
-- read-through (services/courseResolver.js + utils/mappers.js), so the local
-- columns are dead weight that can only drift from Core.

-- Legacy rows with no coreOfferingId predate the Core link and have no Core
-- course to anchor to; delete them before coreOfferingId is made mandatory.
-- onDelete: Cascade on every child relation (Module, Topic, CourseInstructor,
-- CourseEnrollment, and everything cascading below those) removes their
-- orphaned content along with them.
DELETE FROM "public"."CourseOffering" WHERE "coreOfferingId" IS NULL;

-- Drop the externalId lookup index before dropping the column it indexes.
DROP INDEX IF EXISTS "public"."CourseOffering_externalId_idx";

-- Drop every Core-owned column. externalId/externalSource are subsumed by
-- coreOfferingId (they were always 'EDUAI' plus a redundant copy of the same
-- id, never a genuine second source like Canvas).
ALTER TABLE "public"."CourseOffering"
  DROP COLUMN "title",
  DROP COLUMN "description",
  DROP COLUMN "department",
  DROP COLUMN "startDate",
  DROP COLUMN "endDate",
  DROP COLUMN "isPublished",
  DROP COLUMN "externalId",
  DROP COLUMN "externalSource",
  DROP COLUMN "externalMetadata";

-- Every remaining row is Core-originated (anchor rows are only ever created
-- with a coreOfferingId — see services/importTaughtCoursesService.js): make
-- the link mandatory. The existing @unique constraint/index on the column is
-- untouched by this migration.
ALTER TABLE "public"."CourseOffering" ALTER COLUMN "coreOfferingId" SET NOT NULL;
