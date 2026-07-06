/** Multi-server vLLM fleet routing — job types, workload features, pick results. */

export type JobType = "interactive" | "background";

/** Request tag from extensions / chat body (`routingContext.feature`). */
export type WorkloadFeature = "interactive" | "background";

export type FleetServer = {
  id: string;
  baseUrl: string;
  jobTypes: JobType[];
  models: string[];
  energySidecarUrl: string;
};

export type FleetPick = {
  serverId: string;
  baseUrl: string;
  energySidecarUrl: string;
  reason: string;
  jobType: JobType;
};

export type FleetHealthResult = {
  ok: boolean;
  modelIds: string[] | null;
  checkedAt: number;
  error?: string;
};

const LEGACY_FEATURE_TO_JOB: Record<string, JobType> = {
  chat: "interactive",
  tutor: "interactive",
  "question-maker": "background",
  interactive: "interactive",
  background: "background",
};

/** Map routingContext.feature → server pool job type. */
export function jobTypeFromFeature(feature: WorkloadFeature): JobType {
  return feature;
}

export function parseWorkloadFeature(routingContext: unknown): WorkloadFeature {
  if (!routingContext || typeof routingContext !== "object") {
    return "interactive";
  }
  const feature = (routingContext as { feature?: unknown }).feature;
  if (typeof feature === "string" && feature in LEGACY_FEATURE_TO_JOB) {
    return LEGACY_FEATURE_TO_JOB[feature]!;
  }
  return "interactive";
}

export function buildFleetRouterFeatures(
  feature: WorkloadFeature,
  fleetPick: FleetPick | null,
): Record<string, unknown> {
  const jobType = jobTypeFromFeature(feature);
  return {
    feature,
    jobType,
    ...(fleetPick
      ? {
          fleetServerId: fleetPick.serverId,
          fleetReason: fleetPick.reason,
        }
      : {}),
  };
}
