/** Multi-server vLLM fleet routing — job types and pick results. */

export type JobType = "interactive" | "background";

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

const JOB_TYPES: JobType[] = ["interactive", "background"];

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
