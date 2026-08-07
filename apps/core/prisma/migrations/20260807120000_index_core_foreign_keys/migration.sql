-- #1369: gap-fill the unindexed foreign keys that measured hot against the perf seed.
-- Core already carries 47 @@index declarations, so this is a targeted fill, not a
-- blanket add — every index costs write throughput. Candidates that were evaluated and
-- deliberately left out are documented inline in schema.prisma.
--
-- No CREATE INDEX CONCURRENTLY: Prisma runs each migration inside a transaction, where
-- CONCURRENTLY is not permitted. CREATE INDEX takes a SHARE lock, so writes to each table
-- below block for the length of the build. `courses` and `account` grow with content and
-- are small enough that this is a non-event.
--
-- `session` is the exception: it grows with traffic, not content, and better-auth writes
-- it on every sign-in and session refresh, so blocking writes there blocks logins. Before
-- deploying, check the row count:
--
--   SELECT count(*) FROM "session";
--
-- Above ~1M rows, build that one index out-of-band during a quiet window instead of
-- letting migrate do it:
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "session_userId_idx" ON "session"("userId");
--
-- then run `prisma migrate deploy` as normal — the IF NOT EXISTS below makes it a no-op.

-- account — getPasswordChangedAt() filters { userId, providerId: 'credential' } on every
-- authenticated render; the existing unique leads with providerId and cannot serve it.
CREATE INDEX IF NOT EXISTS "account_userId_providerId_idx" ON "account"("userId", "providerId");

-- session.userId — authenticated-request path, plus the User cascade delete.
CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session"("userId");

-- courses.department — FK to disciplines(code) with ON UPDATE CASCADE / ON DELETE RESTRICT.
CREATE INDEX IF NOT EXISTS "courses_department_idx" ON "courses"("department");

-- Not added: questions(topicId) and ai_interactions(courseId). Both measured faster in
-- isolation, but neither backs a query Core actually issues — see the "Measured but not
-- added" section of docs/perf/backend/foreign-key-indexes.md.
