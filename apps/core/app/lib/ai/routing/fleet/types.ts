/** Multi-server vLLM fleet routing — job types, telemetry features, and pick results. */

export type JobType = "interactive" | "background";
/** Telemetry / caller tags. `background` maps to the heavy pool (#878). */
export type WorkloadFeature = "chat" | "tutor" | "background";

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

const WORKLOAD_FEATURES: WorkloadFeature[] = ["chat", "tutor", "background"];
const JOB_TYPES: JobType[] = ["interactive", "background"];

export function featureToJobType(feature: WorkloadFeature): JobType {
  return feature === "background" ? "background" : "interactive";
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

/** Prefer explicit validated `jobType`; else map `feature` (including `background` → heavy pool). */
export function resolveJobType(routingContext: unknown): JobType {
  if (routingContext && typeof routingContext === "object") {
    const jobType = (routingContext as { jobType?: unknown }).jobType;
    if (typeof jobType === "string" && JOB_TYPES.includes(jobType as JobType)) {
      return jobType as JobType;
    }
  }
  return featureToJobType(parseWorkloadFeature(routingContext));
}
