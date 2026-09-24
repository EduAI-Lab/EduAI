-- CreateEnum
CREATE TYPE "AiServiceState" AS ENUM ('OPERATIONAL', 'OUTAGE', 'UNKNOWN');

-- CreateTable
CREATE TABLE "ai_service_samples" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "state" "AiServiceState" NOT NULL,
    "reachable" BOOLEAN NOT NULL,
    "waiting" INTEGER,
    "cacheUsage" DOUBLE PRECISION,
    "intervalMinutes" INTEGER NOT NULL,
    "detail" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_service_samples_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_service_samples_serverId_modelId_observedAt_idx" ON "ai_service_samples"("serverId", "modelId", "observedAt");

-- CreateIndex
CREATE INDEX "ai_service_samples_observedAt_idx" ON "ai_service_samples"("observedAt");
