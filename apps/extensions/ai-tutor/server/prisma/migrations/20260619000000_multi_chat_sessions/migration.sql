-- Drop the old (userId, activityId, mode) unique constraint so that multiple
-- chat sessions per activity mode are allowed (one per Core Chat record).
-- chatId already uniquely identifies a session via Core, so we make that the unique key.

-- Drop the composite unique index that enforced one session per (user, activity, mode)
DROP INDEX IF EXISTS "AiChatSession_userId_activityId_mode_key";

-- Add a unique constraint on chatId (each Core Chat maps to at most one session row)
ALTER TABLE "AiChatSession" ADD CONSTRAINT "AiChatSession_chatId_key" UNIQUE ("chatId");

-- Add indexes for the list-sessions-for-activity query
CREATE INDEX IF NOT EXISTS "AiChatSession_userId_activityId_idx" ON "AiChatSession"("userId", "activityId");
CREATE INDEX IF NOT EXISTS "AiChatSession_userId_activityId_mode_idx" ON "AiChatSession"("userId", "activityId", "mode");
