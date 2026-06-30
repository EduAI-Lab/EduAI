/** Multi-server vLLM fleet routing — job types, workload features, pick results. */

export type JobType = "interactive" | "background";

export type WorkloadFeature = "chat" | "tutor" | "question-maker";

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

const WORKLOAD_FEATURES: WorkloadFeature[] = ["chat", "tutor", "question-maker"];

/** Map extension feature tag → server pool job type. */
export function jobTypeFromFeature(feature: WorkloadFeature): JobType {
  return feature === "question-maker" ? "background" : "interactive";
}

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
