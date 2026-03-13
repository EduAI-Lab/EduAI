ALTER TABLE "apiKey"
ADD COLUMN "configId" TEXT NOT NULL DEFAULT 'default';

CREATE INDEX "apiKey_configId_idx" ON "apiKey"("configId");
