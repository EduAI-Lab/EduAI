import { parseModelIdentifier } from "~/lib/ai/provider-types";
import { getServerHealth, serverHostsModel } from "./health";
import { fleetRoutingEnabled, getServersForJobType, heavyFleetConfigured } from "./registry";
import type { FleetPick, JobType } from "./types";

export type ResolveFleetInput = {
  jobType: JobType;
  resolvedModelId: string;
};

export class FleetUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FleetUnavailableError";
  }
}

let roundRobinIndex = 0;

/** Reset round-robin counter (unit tests). */
export function resetFleetRoundRobin(): void {
  roundRobinIndex = 0;
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

  const candidates = getServersForJobType(input.jobType);
  if (candidates.length === 0) {
    throw new FleetUnavailableError("No fleet servers configured for this workload");
  }

  const eligible: typeof candidates = [];
  for (const server of candidates) {
    const health = await getServerHealth(server.baseUrl);
    if (!health.ok) continue;
    if (!serverHostsModel(parsed.modelId, health.modelIds, server.models)) continue;
    eligible.push(server);
  }

  if (eligible.length === 0) {
    throw new FleetUnavailableError(
      `No healthy fleet server hosts model "${parsed.modelId}" for job type "${input.jobType}"`,
    );
  }

  const server = eligible[roundRobinIndex % eligible.length]!;
  roundRobinIndex += 1;

  return {
    serverId: server.id,
    baseUrl: server.baseUrl,
    reason: pickReason(input.jobType),
  };
}
