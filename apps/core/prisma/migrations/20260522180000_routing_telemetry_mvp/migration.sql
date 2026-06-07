-- CreateEnum
CREATE TYPE "RouterTier" AS ENUM ('TIER_1', 'TIER_2', 'TIER_3');

-- CreateEnum
CREATE TYPE "EnergyMeasurementSource" AS ENUM ('RAPL_CPU', 'NVML_GPU', 'OLLAMA_METRICS', 'ESTIMATED_FROM_TOKENS', 'ESTIMATED_FROM_DURATION');

-- AlterTable
ALTER TABLE "ai_interactions" DROP COLUMN "tokenUsed";

-- AlterTable
ALTER TABLE "ai_interactions" ADD COLUMN     "routedByAuto" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "routerVersion" TEXT,
ADD COLUMN     "routerFeatures" JSONB,
ADD COLUMN     "routerConfidence" DOUBLE PRECISION,
ADD COLUMN     "routerChosenTier" "RouterTier",
ADD COLUMN     "ttftMs" INTEGER,
ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "promptTokens" INTEGER,
ADD COLUMN     "completionTokens" INTEGER,
ADD COLUMN     "estInputCostUsd" DOUBLE PRECISION,
ADD COLUMN     "estOutputCostUsd" DOUBLE PRECISION,
ADD COLUMN     "energyJoules" DOUBLE PRECISION,
ADD COLUMN     "energySource" "EnergyMeasurementSource",
ADD COLUMN     "carbonGramsCO2" DOUBLE PRECISION,
ADD COLUMN     "finishReason" TEXT;

-- AlterTable
ALTER TABLE "ai_models" ADD COLUMN     "routerTier" "RouterTier",
ADD COLUMN     "estEnergyJoulesPerToken" DOUBLE PRECISION,
ADD COLUMN     "averageCarbonGramsPerToken" DOUBLE PRECISION;
