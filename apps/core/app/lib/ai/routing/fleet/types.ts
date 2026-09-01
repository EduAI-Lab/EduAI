import type { JsonObject, JsonValue } from "~/lib/json-value";
import { z } from "zod";
import { asJsonObject } from "~/lib/json-value";
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

const WORKLOAD_FEATURES = [
  "chat",
  "tutor",
  "question-maker",
] as const satisfies readonly WorkloadFeature[];
const JOB_TYPES = ["interactive", "background"] as const satisfies readonly JobType[];

export function parseWorkloadFeature(routingContext: JsonValue | undefined): WorkloadFeature {
  const feature = z.enum(WORKLOAD_FEATURES).safeParse(asJsonObject(routingContext)?.feature);
  return feature.success ? feature.data : "chat";
}

/** Map the legacy feature vocabulary onto the canonical fleet job types. */
export function jobTypeForWorkloadFeature(feature: WorkloadFeature): JobType {
  return feature === "question-maker" ? "background" : "interactive";
}

export function buildFleetRouterFeatures(
  feature: WorkloadFeature,
  fleetPick: FleetPick | null,
): JsonObject {
  // A request the fleet router did not place carries no server attribution.
  return {
    feature,
    fleetServerId: fleetPick?.serverId,
    fleetReason: fleetPick?.reason,
  };
}

/** Parse validated `routingContext.jobType`; default interactive. */
export function parseJobType(routingContext: JsonValue | undefined): JobType {
  const jobType = z.enum(JOB_TYPES).safeParse(asJsonObject(routingContext)?.jobType);
  return jobType.success ? jobType.data : "interactive";
}
