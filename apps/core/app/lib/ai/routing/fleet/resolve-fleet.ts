import { parseModelIdentifier } from "~/lib/ai/provider-types";
import { getServerHealth, serverHostsModel } from "./health";
import { fleetRoutingEnabled, getServersForJobType, heavyFleetConfigured } from "./registry";
import {
  jobTypeForWorkloadFeature,
  type FleetPick,
  type JobType,
  type WorkloadFeature,
} from "./types";

type ResolveFleetInputBase = {
  resolvedModelId: string;
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

function pickReason(jobType: JobType): string {
  if (jobType === "background" && heavyFleetConfigured()) {
    return "background-round-robin";
  }
  return "interactive-round-robin";
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
  const eligible = healthResults
    .filter(
      ({ server, health }) =>
        health.ok && serverHostsModel(parsed.modelId, health.modelIds, server.models),
    )
    .map(({ server }) => server);

  if (eligible.length === 0) {
    throw new FleetUnavailableError(
      `No healthy fleet server hosts model "${parsed.modelId}" for job type "${jobType}"`,
    );
  }

  const pool = poolCursorKey(jobType);
  const server = eligible[nextRoundRobinIndex(pool) % eligible.length]!;

  return {
    serverId: server.id,
    baseUrl: server.baseUrl,
    energySidecarUrl: server.energySidecarUrl,
    reason: pickReason(jobType),
  };
}
