-- Repair only user/activity groups that contain duplicate attempt numbers.
-- Preserve every Submission row and deterministically resequence affected
-- groups before enforcing the composite uniqueness invariant.
WITH "duplicate_groups" AS (
  SELECT "userId", "activityId"
  FROM "public"."Submission"
  GROUP BY "userId", "activityId"
  HAVING COUNT(*) > COUNT(DISTINCT "attemptNumber")
),
"ranked_submissions" AS (
  SELECT
    submission."id",
    ROW_NUMBER() OVER (
      PARTITION BY submission."userId", submission."activityId"
      ORDER BY
        submission."attemptNumber" ASC,
        submission."createdAt" ASC,
        submission."id" ASC
    )::INTEGER AS "nextAttemptNumber"
  FROM "public"."Submission" AS submission
  INNER JOIN "duplicate_groups" AS duplicate_group
    ON duplicate_group."userId" = submission."userId"
    AND duplicate_group."activityId" = submission."activityId"
)
UPDATE "public"."Submission" AS submission
SET "attemptNumber" = ranked_submission."nextAttemptNumber"
FROM "ranked_submissions" AS ranked_submission
WHERE submission."id" = ranked_submission."id";

-- CreateIndex
CREATE UNIQUE INDEX "Submission_userId_activityId_attemptNumber_key"
ON "public"."Submission"("userId", "activityId", "attemptNumber");
