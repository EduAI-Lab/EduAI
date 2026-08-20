import { parseModelIdentifier } from "~/lib/ai/provider-types";
import {
  getServerHealth,
  invalidateFleetHealthCacheForUrl,
  recordFleetHostFailure,
  serverHostsModel,
} from "./health";
import { fleetLoadScore, reserveFleetLoad } from "./load";
import { fleetRoutingEnabled, getServersForJobType, heavyFleetConfigured } from "./registry";
import {
  jobTypeForWorkloadFeature,
  type FleetPick,
  type JobType,
  type WorkloadFeature,
} from "./types";

type ResolveFleetInputBase = {
  resolvedModelId: string;
  /** Skip these server ids (Slice 2 retry after a failed host). */
  excludeServerIds?: string[];
  /** Stable request/session key for cross-process chat affinity. */
  affinityKey?: string;
  /** Reserve the selected server/model so queued requests influence later picks. */
  reserveLoad?: boolean;
};

export type ResolveFleetInput =
  | (ResolveFleetInputBase & { jobType: JobType; feature?: WorkloadFeature })
  | (ResolveFleetInputBase & { feature: WorkloadFeature; jobType?: never });

export class FleetUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FleetUnavailableError";
  }
}

/** Independent round-robin cursor per pool (chat vs heavy). */
const roundRobinByPool = new Map<"interactive" | "background", number>();

/** Reset round-robin counters (unit tests). */
export function resetFleetRoundRobin(): void {
  roundRobinByPool.clear();
}

/** Pool key for the server list actually used (not raw jobType when background falls back to chat). */
function poolCursorKey(jobType: JobType): "interactive" | "background" {
  if (jobType === "background" && heavyFleetConfigured()) {
    return "background";
  }
  return "interactive";
}

function nextRoundRobinIndex(pool: "interactive" | "background"): number {
  const current = roundRobinByPool.get(pool) ?? 0;
  roundRobinByPool.set(pool, current + 1);
  return current;
}

/** Small deterministic hash; unlike the process-local cursor this is stable across Core workers. */
function affinityIndex(value: string, length: number): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % length;
}

function pickReason(jobType: JobType): string {
  if (jobType === "background" && heavyFleetConfigured()) {
    return "background-round-robin";
  }
  return "interactive-round-robin";
}

async function pickServer(
  eligible: Array<{ id: string; baseUrl: string }>,
  jobType: JobType,
  affinityKey: string | undefined,
  modelId: string,
  reserveLoad: boolean,
): Promise<{ server: { id: string; baseUrl: string }; reason: string }> {
  const pool = poolCursorKey(jobType);
  const normalizedAffinityKey = affinityKey?.trim();
  if (normalizedAffinityKey) {
    return {
      server: eligible[affinityIndex(normalizedAffinityKey, eligible.length)]!,
      reason:
        jobType === "background" && heavyFleetConfigured()
          ? "background-affinity"
          : "interactive-affinity",
    };
  }

  if (reserveLoad) {
    const scored = await Promise.all(
      eligible.map(async (server) => ({
        server,
        score: await fleetLoadScore({ jobType, serverId: server.id, modelId }),
      })),
    );
    const lowestScore = Math.min(...scored.map(({ score }) => score));
    const tied = scored
      .filter(({ score }) => score === lowestScore)
      .map(({ server }) => server);
    const server = tied[nextRoundRobinIndex(pool) % tied.length]!;
    return {
      server,
      reason: `${pickReason(jobType)}-load-aware`,
    };
  }

  return {
    server: eligible[nextRoundRobinIndex(pool) % eligible.length]!,
    reason: pickReason(jobType),
  };
}

/**
 * Pick a healthy fleet server that hosts the resolved vLLM model.
 * Returns null when fleet routing is disabled or the model is not vllm:*.
 */
export async function resolveFleetHost(input: ResolveFleetInput): Promise<FleetPick | null> {
  if (!fleetRoutingEnabled()) return null;

  const parsed = parseModelIdentifier(input.resolvedModelId);
  if (!parsed || parsed.providerId !== "vllm") return null;

  const jobType =
    input.jobType ?? jobTypeForWorkloadFeature(input.feature);
  const candidates = getServersForJobType(jobType);
  if (candidates.length === 0) {
    throw new FleetUnavailableError("No fleet servers configured for this workload");
  }

  // Probe the fleet concurrently so a cold request waits for at most one
  // health-check timeout window, regardless of the number of candidates.
  const healthResults = await Promise.all(
    candidates.map(async (server) => ({
      server,
      health: await getServerHealth(server.baseUrl),
    })),
  );
  const excluded = new Set(
    (input.excludeServerIds ?? []).map((id) => id.trim()).filter(Boolean),
  );
  const eligible = healthResults
    .filter(
      ({ server, health }) =>
        !excluded.has(server.id) &&
        health.ok &&
        serverHostsModel(parsed.modelId, health.modelIds, server.models),
    )
    .map(({ server }) => server);

  if (eligible.length === 0) {
    throw new FleetUnavailableError(
      `No healthy fleet server hosts model "${parsed.modelId}" for job type "${jobType}"`,
    );
  }

  const picked = await pickServer(
    eligible,
    jobType,
    input.affinityKey,
    parsed.modelId,
    input.reserveLoad === true,
  );

  return {
    serverId: picked.server.id,
    baseUrl: picked.server.baseUrl,
    reason: excluded.size > 0 ? `${picked.reason}-retry` : picked.reason,
    ...(input.reserveLoad === true
      ? {
          loadLease: await reserveFleetLoad({
            jobType,
            serverId: picked.server.id,
            modelId: parsed.modelId,
          }),
        }
      : {}),
  };
}

/**
 * Slice 2: after inference fails on `failedPick`, invalidate that host and pick
 * another healthy server once. Returns null when no alternate is available.
 */
export async function resolveFleetHostAfterFailure(input: {
  failedPick: FleetPick;
  resolvedModelId: string;
  jobType: JobType;
  affinityKey?: string;
  reserveLoad?: boolean;
}): Promise<FleetPick | null> {
  invalidateFleetHealthCacheForUrl(input.failedPick.baseUrl);
  recordFleetHostFailure(input.failedPick.baseUrl);
  try {
    return await resolveFleetHost({
      jobType: input.jobType,
      resolvedModelId: input.resolvedModelId,
      excludeServerIds: [input.failedPick.serverId],
      affinityKey: input.affinityKey,
      reserveLoad: input.reserveLoad,
    });
  } catch (err) {
    if (err instanceof FleetUnavailableError) return null;
    throw err;
  }
}
