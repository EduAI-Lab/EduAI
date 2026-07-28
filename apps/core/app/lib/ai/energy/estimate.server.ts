/**
 * Token-based energy estimates for passive chat telemetry.
 *
 * Hardware measurement is intentionally owned by scripts/research so the live
 * chat path never waits on or mutates an energy-sidecar session.
 */
import type { EnergyMeasurementSource } from "@prisma/client";

export type EnergyEstimateInput = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens?: number | null;
  /** Per-token constants from the AIModel row. */
  estEnergyJoulesPerToken: number | null;
  averageCarbonGramsPerToken: number | null;
};

export type EnergyEstimateResult = {
  energyJoules: number | null;
  carbonGramsCO2: number | null;
  energySource: EnergyMeasurementSource | null;
};

export function estimateTurnEnergy(
  input: EnergyEstimateInput,
): EnergyEstimateResult {
  const totalTokens =
    input.promptTokens != null && input.completionTokens != null
      ? input.promptTokens + input.completionTokens
      : input.totalTokens ?? null;

  const energyJoules =
    input.estEnergyJoulesPerToken != null && totalTokens != null
      ? input.estEnergyJoulesPerToken * totalTokens
      : null;

  // Carbon without energy is not trustworthy for downstream research queries.
  const carbonGramsCO2 =
    energyJoules != null &&
    input.averageCarbonGramsPerToken != null &&
    totalTokens != null
      ? input.averageCarbonGramsPerToken * totalTokens
      : null;

  return {
    energyJoules,
    carbonGramsCO2,
    energySource: energyJoules != null ? "ESTIMATED_FROM_TOKENS" : null,
  };
}
