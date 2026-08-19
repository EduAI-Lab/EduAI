import type { JsonValue } from "~/lib/json-value";
import type { FleetHealthResult } from "./types";
import { resolveVllmApiKey } from "~/lib/ai/vllm-api-key.server";

const DEFAULT_HEALTH_CACHE_TTL_MS = 30_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 5_000;
const DEFAULT_FAILURE_EJECTION_MS = 30_000;
const MIN_HEALTH_DURATION_MS = 100;
const MAX_HEALTH_DURATION_MS = 120_000;

type CacheEntry = FleetHealthResult;

const healthCache = new Map<string, CacheEntry>();
const ejectedUntilByUrl = new Map<string, number>();

function configuredDuration(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(
    MAX_HEALTH_DURATION_MS,
    Math.max(MIN_HEALTH_DURATION_MS, Math.floor(parsed)),
  );
}

/**
 * Parse `/v1/models` payload.
 * - `null`: response shape unusable → health check marks host unhealthy (no configured-model fallback)
 * - `[]`: endpoint is healthy but hosts no models → do not fall back
 */
function parseModelIds(payload: JsonValue | undefined): string[] | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const data = payload.data;
  if (!Array.isArray(data)) return null;
  const ids: string[] = [];
  for (const entry of data) {
    if (
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      typeof entry.id === "string"
    ) {
      ids.push(entry.id);
    }
  }
  return ids;
}

/** Clear health cache (unit tests). */
export function resetFleetHealthCache(): void {
  healthCache.clear();
  ejectedUntilByUrl.clear();
}

/**
 * Drop a host from the health cache so the next probe is live.
 * Slice 2: call after inference failure before retrying on another host.
 */
export function invalidateFleetHealthCacheForUrl(baseUrl: string): void {
  const normalized = baseUrl.replace(/\/$/, "");
  healthCache.delete(normalized);
}

/** Temporarily remove a host after an inference failure. */
export function recordFleetHostFailure(baseUrl: string): void {
  const normalized = baseUrl.replace(/\/$/, "");
  const durationMs = configuredDuration(
    "FLEET_FAILURE_EJECTION_MS",
    DEFAULT_FAILURE_EJECTION_MS,
  );
  ejectedUntilByUrl.set(normalized, Date.now() + durationMs);
  healthCache.delete(normalized);
}

export async function getServerHealth(baseUrl: string): Promise<FleetHealthResult> {
  const normalized = baseUrl.replace(/\/$/, "");
  const now = Date.now();
  const ejectedUntil = ejectedUntilByUrl.get(normalized);
  if (ejectedUntil !== undefined) {
    if (ejectedUntil > now) {
      return {
        ok: false,
        modelIds: null,
        checkedAt: now,
        error: `host ejected for ${ejectedUntil - now}ms after inference failure`,
      };
    }
    ejectedUntilByUrl.delete(normalized);
  }
  const cached = healthCache.get(normalized);
  const cacheTtlMs = configuredDuration(
    "FLEET_HEALTH_CACHE_TTL_MS",
    DEFAULT_HEALTH_CACHE_TTL_MS,
  );
  const timeoutMs = configuredDuration(
    "FLEET_HEALTH_TIMEOUT_MS",
    DEFAULT_HEALTH_TIMEOUT_MS,
  );
  if (cached && now - cached.checkedAt < cacheTtlMs) {
    return cached;
  }

  const checkedAt = now;
  const apiKey = resolveVllmApiKey();
  if (!apiKey) {
    const result: FleetHealthResult = {
      ok: false,
      modelIds: null,
      checkedAt,
      error: "VLLM_API_KEY not configured",
    };
    healthCache.set(normalized, result);
    return result;
  }

  try {
    const res = await fetch(`${normalized}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const result: FleetHealthResult = {
        ok: false,
        modelIds: null,
        checkedAt,
        error: `HTTP ${res.status}`,
      };
      healthCache.set(normalized, result);
      return result;
    }
    // SAFETY: `Response#json` resolves to whatever the host sent; naming it
    // `JsonValue` claims only what JSON parsing already guarantees.
    const body = (await res.json()) as JsonValue;
    const modelIds = parseModelIds(body);
    // HTTP 200 without a valid `data` array is unhealthy — do not fall back to configured models.
    if (modelIds === null) {
      const result: FleetHealthResult = {
        ok: false,
        modelIds: null,
        checkedAt,
        error: "invalid /v1/models response",
      };
      healthCache.set(normalized, result);
      return result;
    }
    const result: FleetHealthResult = {
      ok: true,
      modelIds,
      checkedAt,
    };
    ejectedUntilByUrl.delete(normalized);
    healthCache.set(normalized, result);
    return result;
  } catch (err) {
    const result: FleetHealthResult = {
      ok: false,
      modelIds: null,
      checkedAt,
      error: err instanceof Error ? err.message : "health check failed",
    };
    healthCache.set(normalized, result);
    return result;
  }
}

export function serverHostsModel(
  modelId: string,
  healthModelIds: string[] | null,
  configuredModels: string[],
): boolean {
  const needle = modelId.toLowerCase();
  // Explicit empty list means the host reported zero models — do not use defaults.
  if (healthModelIds !== null) {
    return healthModelIds.some((id) => id.toLowerCase() === needle);
  }
  return configuredModels.some((id) => id.toLowerCase() === needle);
}
