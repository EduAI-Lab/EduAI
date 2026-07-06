import type { FleetHealthResult } from "./types";

const HEALTH_CACHE_TTL_MS = 30_000;
const HEALTH_TIMEOUT_MS = 5_000;

type CacheEntry = FleetHealthResult;

const healthCache = new Map<string, CacheEntry>();

function vllmAuthHeader(): string {
  return process.env.VLLM_API_KEY?.trim() || "vllm-local";
}

function parseModelIds(payload: unknown): string[] | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as { data?: unknown };
  if (!Array.isArray(data.data)) return null;
  const ids: string[] = [];
  for (const entry of data.data) {
    if (entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string") {
      ids.push((entry as { id: string }).id);
    }
  }
  return ids.length > 0 ? ids : null;
}

/** Clear all health cache entries (unit tests). */
export function resetFleetHealthCache(): void {
  healthCache.clear();
}

/** Drop cached health for one host (Slice 2 — after inference failure). */
export function invalidateFleetHealthCacheForUrl(baseUrl: string): void {
  healthCache.delete(baseUrl.replace(/\/$/, ""));
}

export async function getServerHealth(baseUrl: string): Promise<FleetHealthResult> {
  const normalized = baseUrl.replace(/\/$/, "");
  const cached = healthCache.get(normalized);
  if (cached && Date.now() - cached.checkedAt < HEALTH_CACHE_TTL_MS) {
    return cached;
  }

  const checkedAt = Date.now();
  try {
    const res = await fetch(`${normalized}/v1/models`, {
      headers: { Authorization: `Bearer ${vllmAuthHeader()}` },
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
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
    const body = (await res.json()) as unknown;
    const result: FleetHealthResult = {
      ok: true,
      modelIds: parseModelIds(body),
      checkedAt,
    };
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
  if (healthModelIds && healthModelIds.length > 0) {
    return healthModelIds.some((id) => id.toLowerCase() === needle);
  }
  return configuredModels.some((id) => id.toLowerCase() === needle);
}
