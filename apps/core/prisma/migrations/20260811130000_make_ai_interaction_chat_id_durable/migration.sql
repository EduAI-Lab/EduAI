-- AIInteraction.chatId is a durable correlation id for metrics, not a
-- lifecycle-owned relation. Keep historical distinct-chat counts stable when
-- an interactive Chat row is deleted.
ALTER TABLE "ai_interactions"
  DROP CONSTRAINT IF EXISTS "ai_interactions_chatId_fkey";
