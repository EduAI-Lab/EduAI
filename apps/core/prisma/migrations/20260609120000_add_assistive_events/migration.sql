-- CreateTable
CREATE TABLE "assistive_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chatId" TEXT,
    "adhdAssist" BOOLEAN NOT NULL DEFAULT false,
    "eventType" TEXT NOT NULL,
    "metricsJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistive_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistive_events_userId_createdAt_idx" ON "assistive_events"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "assistive_events_eventType_createdAt_idx" ON "assistive_events"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "assistive_events_adhdAssist_createdAt_idx" ON "assistive_events"("adhdAssist", "createdAt");

-- CreateIndex
CREATE INDEX "assistive_events_chatId_idx" ON "assistive_events"("chatId");

-- AddForeignKey
ALTER TABLE "assistive_events" ADD CONSTRAINT "assistive_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistive_events" ADD CONSTRAINT "assistive_events_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "chats"("id") ON DELETE SET NULL ON UPDATE CASCADE;
