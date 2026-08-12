-- #1369: session.userId — authenticated-request path, plus the User cascade delete.
--
-- Single statement on purpose, and CONCURRENTLY on purpose. See the header of
-- 20260807120000_index_account_user_provider for why the two go together.
--
-- session is the table that most needs the concurrent build: it grows with traffic rather
-- than content, and better-auth writes it on every sign-in and session refresh, so a
-- plain CREATE INDEX would block logins for the length of the build.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "session_userId_idx" ON "session"("userId");
