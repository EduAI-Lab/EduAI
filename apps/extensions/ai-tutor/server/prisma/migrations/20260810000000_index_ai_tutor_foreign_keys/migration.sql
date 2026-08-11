-- #1374: index the AI-Tutor content-tree foreign keys.
--
-- Every parent-to-children hop in CourseOffering -> Module -> Lesson -> Activity ->
-- Submission filtered on an unindexed foreign key, so each one was a sequential scan.
-- The schema carried 2 @@index declarations across 18 models; a pg_constraint x pg_index
-- leading-column test found 14 foreign keys with no index that Postgres could seek on.
--
-- "Unindexed" here means unindexed *as a leading column*. Several of these columns do
-- appear in an existing composite key, but only in a trailing position, and Postgres can
-- only seek on a leading column:
--   ActivityFeedback.activityId       - trailing half of @@unique([userId, activityId])
--   ActivityStudentMetric.activityId  - trailing half of @@unique([userId, activityId])
--   AiChatSession.activityId          - trailing in the existing (userId, ...) index
--   ActivitySecondaryTopic.topicId    - trailing half of @@id([activityId, topicId])
--   CourseEnrollment.userId           - trailing half of @@id([courseOfferingId, userId])
-- The composites are kept: they serve the per-user reads. The single-column indexes below
-- serve the activity-scoped reads and the ON DELETE CASCADE / SET NULL integrity checks.
--
-- One candidate was evaluated and deliberately NOT indexed: Activity.promptTemplateId. It
-- is only written, or read back as a scalar off an already-loaded activity row; it appears
-- in no where-filter, and no code path deletes a PromptTemplate, so its ON DELETE SET NULL
-- check never runs. Reasoning is recorded on the Activity model in schema.prisma so it is
-- not re-derived later.
--
-- Two user-scoped columns are indexed here even though they carry no FK (the User table is
-- owned by Core, so a pg_constraint audit cannot see them): Submission.userId and
-- CourseEnrollment.userId are the leading predicate of the "my submissions" and "my
-- courses" reads and of every course-access check.
--
-- No CREATE INDEX CONCURRENTLY: Prisma runs each migration inside a transaction, where it
-- is not permitted, and nothing else in prisma/migrations uses it. At current volumes the
-- brief write lock is a non-issue. If production volume ever changes that, create the index
-- out-of-band and mark this migration applied with `prisma migrate resolve --applied`.

-- Content tree: the four hops measured hottest.
CREATE INDEX IF NOT EXISTS "Activity_lessonId_idx" ON "Activity"("lessonId");
CREATE INDEX IF NOT EXISTS "Submission_activityId_idx" ON "Submission"("activityId");
CREATE INDEX IF NOT EXISTS "Lesson_moduleId_idx" ON "Lesson"("moduleId");
CREATE INDEX IF NOT EXISTS "Module_courseOfferingId_idx" ON "Module"("courseOfferingId");

-- Activity-scoped satellite tables (all reached by activityId, all ON DELETE CASCADE).
CREATE INDEX IF NOT EXISTS "ActivityFeedback_activityId_idx" ON "ActivityFeedback"("activityId");
CREATE INDEX IF NOT EXISTS "ActivityStudentMetric_activityId_idx" ON "ActivityStudentMetric"("activityId");
CREATE INDEX IF NOT EXISTS "AiChatSession_activityId_idx" ON "AiChatSession"("activityId");
CREATE INDEX IF NOT EXISTS "AiInteractionTrace_activityId_idx" ON "AiInteractionTrace"("activityId");

-- Nullable FKs with ON DELETE SET NULL: the parent delete has to find these rows.
CREATE INDEX IF NOT EXISTS "ActivityFeedback_submissionId_idx" ON "ActivityFeedback"("submissionId");
CREATE INDEX IF NOT EXISTS "AiInteractionTrace_aiChatSessionId_idx" ON "AiInteractionTrace"("aiChatSessionId");

-- Roster and topic join.
CREATE INDEX IF NOT EXISTS "CourseInstructor_courseOfferingId_idx" ON "CourseInstructor"("courseOfferingId");
CREATE INDEX IF NOT EXISTS "ActivitySecondaryTopic_topicId_idx" ON "ActivitySecondaryTopic"("topicId");

-- Activity.mainTopicId: the topic remap route filters activity.updateMany({ where:
-- { mainTopicId } }) and then deletes the source topics, and the relation is required, so
-- it is ON DELETE RESTRICT — every topic delete (remap, and the CourseOffering cascade)
-- scans Activity to look for referencing rows without this.
CREATE INDEX IF NOT EXISTS "Activity_mainTopicId_idx" ON "Activity"("mainTopicId");

-- Per-user reads on Core-owned user ids (no FK, so invisible to the FK audit).
CREATE INDEX IF NOT EXISTS "Submission_userId_idx" ON "Submission"("userId");
CREATE INDEX IF NOT EXISTS "CourseEnrollment_userId_idx" ON "CourseEnrollment"("userId");

-- Redundant: a strict leading prefix of AiChatSession_userId_activityId_mode_idx, so it
-- serves no read that index does not, and costs a write on every session insert.
DROP INDEX IF EXISTS "AiChatSession_userId_activityId_idx";
