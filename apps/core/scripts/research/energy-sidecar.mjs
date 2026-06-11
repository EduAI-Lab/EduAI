/**
 * Client helpers for tools/energy-meter sidecar (RAPL + NVML).
 *
 * Set ENERGY_SIDECAR_URL=http://127.0.0.1:9100 and RESEARCH_MEASURE_ENERGY=1.
 */

function readSidecarUrl() {
  const url = process.env.ENERGY_SIDECAR_URL?.trim();
  return url ? url.replace(/\/$/, "") : null;
}

export function isEnergyMeasurementEnabled() {
  return process.env.RESEARCH_MEASURE_ENERGY === "1" && Boolean(readSidecarUrl());
}

export function resolveEnergySettleMs() {
  return Math.max(0, Number(process.env.RESEARCH_ENERGY_SETTLE_MS ?? "0") || 0);
}

export async function energyMeasureStart(tag) {
  const base = readSidecarUrl();
  if (!base) return null;
  const res = await fetch(`${base}/measure-start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`energy measure-start HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  return json.tag ?? tag;
}

export async function energyMeasureStop(tag) {
  const base = readSidecarUrl();
  if (!base) return null;
  const res = await fetch(`${base}/measure-stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(tag ? { tag } : {}),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`energy measure-stop HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export async function withEnergyMeasurement(tag, fn) {
  if (!isEnergyMeasurementEnabled()) {
    return { result: await fn(), energy: null };
  }
  const settleMs = resolveEnergySettleMs();
  if (settleMs > 0) await new Promise((r) => setTimeout(r, settleMs));
  const sessionTag = await energyMeasureStart(tag);
  try {
    const result = await fn();
    const energy = await energyMeasureStop(sessionTag);
    return { result, energy };
  } catch (e) {
    try {
      await energyMeasureStop(sessionTag);
    } catch {
      /* ignore cleanup failure */
    }
    throw e;
  }
}

export function flattenEnergyFields(energy) {
  if (!energy) {
    return {
      joules_cpu: null,
      joules_gpu: null,
      joules_dram: null,
      energy_joules: null,
      carbon_grams_co2: null,
      energy_source: null,
      energy_duration_ms: null,
    };
  }
  return {
    joules_cpu: energy.joulesCpu ?? null,
    joules_gpu: energy.joulesGpu ?? null,
    joules_dram: energy.joulesDram ?? null,
    energy_joules: energy.energyJoules ?? energy.joulesTotal ?? null,
    carbon_grams_co2: energy.carbonGramsCO2 ?? null,
    energy_source: energy.source ?? null,
    energy_duration_ms: energy.durationMs ?? null,
  };
}
