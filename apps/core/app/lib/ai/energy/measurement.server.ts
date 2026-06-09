/**
 * Phase 2 — energy measurement abstraction (Step 23 stub).
 *
 * Today: only token-based estimates are implemented (Phase 0/1).
 * Future: sidecar on Ollama host (RAPL / NVML / Ollama metrics) when Q1 deployment is fixed.
 */
import type { EnergyMeasurementSource } from "@prisma/client";

export type EnergyMeasurementInput = {
  registryModelId: string;
  promptTokens: number | null;
  completionTokens: number | null;
  durationMs: number | null;
  /** Per-token constants from AIModel row */
  estEnergyJoulesPerToken: number | null;
  averageCarbonGramsPerToken: number | null;
};

export type EnergyMeasurementResult = {
  energyJoules: number | null;
  carbonGramsCO2: number | null;
  energySource: EnergyMeasurementSource | null;
};

const SIDECAR_URL = process.env.ENERGY_SIDECAR_URL?.trim();

/**
 * Resolve energy/carbon for a completed chat turn.
 * Uses sidecar when ENERGY_SIDECAR_URL is set and reachable; otherwise token estimate.
 */
export async function measureTurnEnergy(
  input: EnergyMeasurementInput,
): Promise<EnergyMeasurementResult> {
  if (SIDECAR_URL) {
    try {
      const res = await fetch(`${SIDECAR_URL.replace(/\/$/, "")}/measure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: input.registryModelId,
          durationMs: input.durationMs,
          promptTokens: input.promptTokens,
          completionTokens: input.completionTokens,
        }),
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          energyJoules?: number;
          carbonGramsCO2?: number;
          source?: EnergyMeasurementSource;
        };
        return {
          energyJoules: data.energyJoules ?? null,
          carbonGramsCO2: data.carbonGramsCO2 ?? null,
          energySource: data.source ?? "OLLAMA_METRICS",
        };
      }
    } catch {
      /* fall through to estimate */
    }
  }

  const totalTokens =
    input.promptTokens != null && input.completionTokens != null
      ? input.promptTokens + input.completionTokens
      : null;

  const energyJoules =
    input.estEnergyJoulesPerToken != null && totalTokens != null
      ? input.estEnergyJoulesPerToken * totalTokens
      : null;

  const carbonGramsCO2 =
    input.averageCarbonGramsPerToken != null && totalTokens != null
      ? input.averageCarbonGramsPerToken * totalTokens
      : null;

  return {
    energyJoules,
    carbonGramsCO2,
    energySource: energyJoules != null ? "ESTIMATED_FROM_TOKENS" : null,
  };
}
