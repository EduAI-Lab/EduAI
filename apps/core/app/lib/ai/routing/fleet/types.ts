/** Multi-server vLLM fleet routing — job types, telemetry features, and pick results. */

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

export function featureToJobType(feature: WorkloadFeature): JobType {
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
