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

type SidecarStopPayload = {
  energyJoules?: number;
  carbonGramsCO2?: number;
  source?: EnergyMeasurementSource | string;
};

function sidecarBaseUrl(): string | null {
  return SIDECAR_URL ? SIDECAR_URL.replace(/\/$/, "") : null;
}

/** Start a hardware measurement session on the energy-meter sidecar. */
export async function startSidecarMeasurement(tag: string): Promise<string | null> {
  const base = sidecarBaseUrl();
  if (!base) return null;
  const res = await fetch(`${base}/measure-start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag }),
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { tag?: string };
  return data.tag ?? tag;
}

/** Stop sidecar measurement and return Joules / carbon if available. */
export async function stopSidecarMeasurement(
  tag: string,
): Promise<EnergyMeasurementResult | null> {
  const base = sidecarBaseUrl();
  if (!base) return null;
  const res = await fetch(`${base}/measure-stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag }),
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as SidecarStopPayload;
  return {
    energyJoules: data.energyJoules ?? null,
    carbonGramsCO2: data.carbonGramsCO2 ?? null,
    energySource: mapSidecarSource(data.source),
  };
}

function mapSidecarSource(
  source: string | undefined,
): EnergyMeasurementSource | null {
  if (source === "RAPL_CPU" || source === "NVML_GPU") return source;
  if (source === "RAPL_PLUS_NVML") return "NVML_GPU";
  return null;
}

/**
 * Resolve energy/carbon for a completed chat turn.
 * Uses sidecar /measure-stop result when EXPERIMENT_MODE recorded a session tag;
 * otherwise falls back to token estimate.
 */
export async function measureTurnEnergy(
  input: EnergyMeasurementInput,
  options?: { sidecarTag?: string | null },
): Promise<EnergyMeasurementResult> {
  if (options?.sidecarTag) {
    const measured = await stopSidecarMeasurement(options.sidecarTag);
    if (measured?.energyJoules != null) {
      return measured;
    }
  }

  if (SIDECAR_URL) {
    try {
      const res = await fetch(`${sidecarBaseUrl()}/measure`, {
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
        const data = (await res.json()) as SidecarStopPayload;
        if (data.energyJoules != null) {
          return {
            energyJoules: data.energyJoules,
            carbonGramsCO2: data.carbonGramsCO2 ?? null,
            energySource: mapSidecarSource(data.source),
          };
        }
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
