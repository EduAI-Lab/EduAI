/** Multi-server vLLM fleet routing — job types, chat features, and pick results. */

export type JobType = "interactive" | "background";
export type WorkloadFeature = "chat" | "tutor" | "question-maker";

export type FleetServer = {
  id: string;
  baseUrl: string;
  jobTypes: JobType[];
  models: string[];
};

export type FleetPick = {
  serverId: string;
  baseUrl: string;
  reason: string;
};

export type FleetHealthResult = {
  ok: boolean;
  modelIds: string[] | null;
  checkedAt: number;
  error?: string;
};

const WORKLOAD_FEATURES: WorkloadFeature[] = ["chat", "tutor", "question-maker"];
const JOB_TYPES: JobType[] = ["interactive", "background"];

export function parseWorkloadFeature(routingContext: unknown): WorkloadFeature {
  if (!routingContext || typeof routingContext !== "object") {
    return "chat";
  }
  const feature = (routingContext as { feature?: unknown }).feature;
  if (typeof feature === "string" && WORKLOAD_FEATURES.includes(feature as WorkloadFeature)) {
    return feature as WorkloadFeature;
  }
  return "chat";
}

/** Map the legacy feature vocabulary onto the canonical fleet job types. */
export function jobTypeForWorkloadFeature(feature: WorkloadFeature): JobType {
  return feature === "question-maker" ? "background" : "interactive";
}

export function buildFleetRouterFeatures(
  feature: WorkloadFeature,
  fleetPick: FleetPick | null,
): Record<string, unknown> {
  return {
    feature,
    ...(fleetPick
      ? { fleetServerId: fleetPick.serverId, fleetReason: fleetPick.reason }
      : {}),
  };
}

/** Parse validated `routingContext.jobType`; default interactive. */
export function parseJobType(routingContext: unknown): JobType {
  if (routingContext && typeof routingContext === "object") {
    const jobType = (routingContext as { jobType?: unknown }).jobType;
    if (typeof jobType === "string" && JOB_TYPES.includes(jobType as JobType)) {
      return jobType as JobType;
    }
  }
  return "interactive";
}
