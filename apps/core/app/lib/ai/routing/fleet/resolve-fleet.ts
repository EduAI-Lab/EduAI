import { parseModelIdentifier } from "~/lib/ai/provider-types";
import {
  getServerHealth,
  invalidateFleetHealthCacheForUrl,
  recordFleetHostFailure,
  serverHostsModel,
} from "./health";
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

/** Small deterministic hash (FNV-1a); stable across Core workers. */
function fnv1a(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Rendezvous (highest random weight) hashing: score every eligible server by
 * hashing the affinity key together with that server's id, and pick the
 * highest score. Unlike `hash(key) % eligible.length`, this only remaps keys
 * that actually resolved to the removed/added host — every other key keeps
 * scoring highest for the same server it always did, so a single host
 * ejection (or recovery) reshuffles roughly 1/N of affinity keys instead of
 * nearly all of them.
 */
function affinityServer<T extends { id: string }>(value: string, eligible: T[]): T {
  let best = eligible[0]!;
  let bestScore = fnv1a(`${value}#${best.id}`);
  for (let index = 1; index < eligible.length; index += 1) {
    const candidate = eligible[index]!;
    const score = fnv1a(`${value}#${candidate.id}`);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function pickReason(jobType: JobType): string {
  if (jobType === "background" && heavyFleetConfigured()) {
    return "background-round-robin";
  }
  return "interactive-round-robin";
}

function pickServer(
  eligible: Array<{ id: string; baseUrl: string }>,
  jobType: JobType,
  affinityKey: string | undefined,
) {
  const pool = poolCursorKey(jobType);
  const normalizedAffinityKey = affinityKey?.trim();
  if (normalizedAffinityKey) {
    return {
      server: affinityServer(normalizedAffinityKey, eligible),
      reason:
        jobType === "background" && heavyFleetConfigured()
          ? "background-affinity"
          : "interactive-affinity",
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

  const jobType = input.jobType ?? jobTypeForWorkloadFeature(input.feature);
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
  const excluded = new Set((input.excludeServerIds ?? []).map((id) => id.trim()).filter(Boolean));
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

  const { server, reason } = pickServer(eligible, jobType, input.affinityKey);

  return {
    serverId: server.id,
    baseUrl: server.baseUrl,
    reason: excluded.size > 0 ? `${reason}-retry` : reason,
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
}): Promise<FleetPick | null> {
  invalidateFleetHealthCacheForUrl(input.failedPick.baseUrl);
  recordFleetHostFailure(input.failedPick.baseUrl);
  try {
    return await resolveFleetHost({
      jobType: input.jobType,
      resolvedModelId: input.resolvedModelId,
      excludeServerIds: [input.failedPick.serverId],
      affinityKey: input.affinityKey,
    });
  } catch (err) {
    if (err instanceof FleetUnavailableError) return null;
    throw err;
  }
}
