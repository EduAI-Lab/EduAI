/**
 * Client helpers for tools/energy-meter sidecar (RAPL + NVML).
 *
 * Energy measurement is on by default for research scripts. Set
 * RESEARCH_MEASURE_ENERGY=0 to skip. Sidecar URL defaults to
 * http://127.0.0.1:9100 (override with ENERGY_SIDECAR_URL).
 */

export const DEFAULT_ENERGY_SIDECAR_URL = "http://127.0.0.1:9100";

function resolveSidecarUrl() {
  const url = process.env.ENERGY_SIDECAR_URL?.trim();
  return (url || DEFAULT_ENERGY_SIDECAR_URL).replace(/\/$/, "");
}

export function isEnergyMeasurementEnabled() {
  if (process.env.RESEARCH_MEASURE_ENERGY === "0") {
    return false;
  }
  return Boolean(resolveSidecarUrl());
}

function sidecarAuthHeaders() {
  const key = process.env.CMPS01_INTERNAL_KEY?.trim();
  return key ? { "X-EduAI-Internal-Key": key } : {};
}

function sidecarFetchInit(init) {
  return {
    ...init,
    headers: {
      ...sidecarAuthHeaders(),
      ...init.headers,
    },
  };
}

export { sidecarFetchInit };

export async function ensureResearchEnergyReady() {
  if (!isEnergyMeasurementEnabled()) {
    return;
  }
  const base = resolveSidecarUrl();
  try {
    const res = await fetch(
      `${base}/health`,
      sidecarFetchInit({ signal: AbortSignal.timeout(8000) }),
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const health = await res.json();
    if (health.canMeasure === false) {
      throw new Error(
        `Sidecar at ${base} has no RAPL/NVML (canMeasure=false). ` +
          "Run energy-meter on cmps01 (GPU host), not s378.",
      );
    }
    const tag = `preflight-${Date.now()}`;
    await energyMeasureStart(tag);
    await new Promise((r) => setTimeout(r, 1500));
    const probe = await energyMeasureStop(tag);
    if (probe.energyJoules == null && probe.joulesTotal == null) {
      throw new Error(
        `Sidecar at ${base} returned null Joules on probe. ` +
          "Deploy tools/energy-meter on cmps01 and set ENERGY_SIDECAR_URL (e.g. http://cmps01.ok.ubc.ca:8001/energy via nginx).",
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Energy sidecar not ready at ${base} (${msg}). ` +
        "See tools/energy-meter/README.md — cmps01 Docker deploy.",
    );
  }
}

export function resolveEnergySettleMs() {
  return Math.max(0, Number(process.env.RESEARCH_ENERGY_SETTLE_MS ?? "0") || 0);
}

export async function energyMeasureStart(tag) {
  const base = resolveSidecarUrl();
  const res = await fetch(
    `${base}/measure-start`,
    sidecarFetchInit({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag }),
      signal: AbortSignal.timeout(5000),
    }),
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`energy measure-start HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  return json.tag ?? tag;
}

export async function energyMeasureStop(tag) {
  const base = resolveSidecarUrl();
  const res = await fetch(
    `${base}/measure-stop`,
    sidecarFetchInit({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tag ? { tag } : {}),
      signal: AbortSignal.timeout(5000),
    }),
  );
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
