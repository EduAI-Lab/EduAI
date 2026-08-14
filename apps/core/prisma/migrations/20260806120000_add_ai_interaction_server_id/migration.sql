-- Track which fleet server (e.g. "cmps01") served each interaction so admins
-- can chart routing volume per server (#1351). Free-form string, not an enum,
-- so new servers (AWS, etc.) require no schema change. Null for interactions
-- that predate this column or were not fleet-routed.

-- AlterTable
ALTER TABLE "ai_interactions" ADD COLUMN "serverId" TEXT;

-- CreateIndex
CREATE INDEX "ai_interactions_serverId_idx" ON "ai_interactions"("serverId");
