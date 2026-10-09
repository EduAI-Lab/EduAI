-- Let an admin delete a user who has history (#1959).
--
-- Three foreign keys to "user" were left on the default RESTRICT, so
-- DELETE /api/users/:id failed with CANNOT_DELETE_USER_WITH_DATA for anyone who
-- had ever chatted, authored a question, or run a Canvas roster sync:
--
--   * ai_interactions.userId      -> CASCADE. Per-user chat history; the user's
--     chats and chat_messages already cascade, so the interactions go with them.
--   * questions.createdBy         -> SET NULL. Questions belong to the course's
--     bank, so they outlive their author.
--   * canvas_roster_members.syncedByUserId -> SET NULL. Roster rows belong to the
--     course; the syncing user is only provenance.

ALTER TABLE "questions" ALTER COLUMN "createdBy" DROP NOT NULL;
ALTER TABLE "canvas_roster_members" ALTER COLUMN "syncedByUserId" DROP NOT NULL;

ALTER TABLE "ai_interactions" DROP CONSTRAINT "ai_interactions_userId_fkey";
ALTER TABLE "ai_interactions" ADD CONSTRAINT "ai_interactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "questions" DROP CONSTRAINT "questions_createdBy_fkey";
ALTER TABLE "questions" ADD CONSTRAINT "questions_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "canvas_roster_members" DROP CONSTRAINT "canvas_roster_members_syncedByUserId_fkey";
ALTER TABLE "canvas_roster_members" ADD CONSTRAINT "canvas_roster_members_syncedByUserId_fkey" FOREIGN KEY ("syncedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
