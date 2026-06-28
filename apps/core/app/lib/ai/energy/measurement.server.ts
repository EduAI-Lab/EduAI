/**
 * Energy measurement for completed chat turns (hardware sidecar or token estimate).
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

function sidecarBaseUrl(override?: string | null): string | null {
  const raw = override?.trim() || SIDECAR_URL?.trim();
  return raw ? raw.replace(/\/$/, "") : null;
}

/** Start a hardware measurement session on the energy-meter sidecar. */
export async function startSidecarMeasurement(
  tag: string,
  options?: { sidecarBaseUrl?: string | null },
): Promise<string | null> {
  const base = sidecarBaseUrl(options?.sidecarBaseUrl);
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
  options?: { sidecarBaseUrl?: string | null },
): Promise<EnergyMeasurementResult | null> {
  const base = sidecarBaseUrl(options?.sidecarBaseUrl);
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

function tokenEstimate(input: EnergyMeasurementInput): EnergyMeasurementResult {
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

/**
 * Resolve energy/carbon for a completed chat turn.
 * Requires a sidecar session tag for hardware measurement; otherwise uses token estimate.
 */
export async function measureTurnEnergy(
  input: EnergyMeasurementInput,
  options?: { sidecarTag?: string | null; sidecarBaseUrl?: string | null },
): Promise<EnergyMeasurementResult> {
  const resolvedSidecarUrl = sidecarBaseUrl(options?.sidecarBaseUrl);

  if (options?.sidecarTag && resolvedSidecarUrl) {
    const measured = await stopSidecarMeasurement(options.sidecarTag, {
      sidecarBaseUrl: resolvedSidecarUrl,
    });
    if (measured?.energyJoules != null) {
      return measured;
    }
  }

  return tokenEstimate(input);
}
