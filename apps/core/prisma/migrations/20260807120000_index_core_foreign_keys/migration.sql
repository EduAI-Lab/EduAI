-- #1369: gap-fill the unindexed foreign keys that measured hot against the perf seed.
-- Core already carries 47 @@index declarations, so this is a targeted fill, not a
-- blanket add — every index costs write throughput. Candidates that were evaluated and
-- deliberately left out are documented inline in schema.prisma.
--
-- No CREATE INDEX CONCURRENTLY: Prisma runs each migration inside a transaction, where
-- CONCURRENTLY is not permitted. These tables are small enough that the brief write lock
-- is acceptable. If production volume changes that, create the index out-of-band and mark
-- this migration applied with `prisma migrate resolve`.

-- questions.topicId — the existing (courseId, topicId, testable) index leads with courseId,
-- so a topic-only filter cannot use it. 5.349 ms Seq Scan -> 0.131 ms Index Scan (10,058 rows).
CREATE INDEX IF NOT EXISTS "questions_topicId_idx" ON "questions"("topicId");

-- ai_interactions.courseId — 3.287 ms Seq Scan -> 0.132 ms Index Scan (1,373 rows).
CREATE INDEX IF NOT EXISTS "ai_interactions_courseId_idx" ON "ai_interactions"("courseId");

-- account — getPasswordChangedAt() filters { userId, providerId: 'credential' } on every
-- authenticated render; the existing unique leads with providerId and cannot serve it.
CREATE INDEX IF NOT EXISTS "account_userId_providerId_idx" ON "account"("userId", "providerId");

-- session.userId — authenticated-request path, plus the User cascade delete.
CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session"("userId");

-- courses.department — FK to disciplines(code) with ON UPDATE CASCADE / ON DELETE RESTRICT.
CREATE INDEX IF NOT EXISTS "courses_department_idx" ON "courses"("department");
