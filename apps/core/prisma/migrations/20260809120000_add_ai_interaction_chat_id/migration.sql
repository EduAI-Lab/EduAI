-- AlterTable
ALTER TABLE "ai_interactions" ADD COLUMN "chatId" TEXT;

-- CreateIndex
CREATE INDEX "ai_interactions_chatId_idx" ON "ai_interactions"("chatId");

-- AddForeignKey
ALTER TABLE "ai_interactions" ADD CONSTRAINT "ai_interactions_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "chats"("id") ON DELETE SET NULL ON UPDATE CASCADE;
