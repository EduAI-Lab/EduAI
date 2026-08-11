-- #1369: courses.department — FK to disciplines(code) with ON UPDATE CASCADE and
-- ON DELETE RESTRICT, neither of which has an index to seek.
--
-- Single statement on purpose, and CONCURRENTLY on purpose. See the header of
-- 20260807120000_index_account_user_provider for why the two go together.
--
-- Not added here: questions(topicId) and ai_interactions(courseId). Both measured faster
-- in isolation, but neither backs a query Core actually issues — see the "Measured
-- faster, but not added" section of docs/perf/backend/foreign-key-indexes.md.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "courses_department_idx" ON "courses"("department");
