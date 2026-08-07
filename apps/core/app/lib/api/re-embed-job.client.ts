import { readJsonResponse } from "./client";

export type ReEmbedJobResponse = {
  id: string;
  courseId: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED";
  totalMaterials: number;
  processedCount: number;
  failed: string[];
  currentMaterialTitle: string | null;
  errorMessage: string | null;
};

const TERMINAL_STATUSES = new Set<ReEmbedJobResponse["status"]>([
  "COMPLETED",
  "PARTIAL",
  "FAILED",
]);

export function isReEmbedJobTerminal(status: ReEmbedJobResponse["status"]): boolean {
  return TERMINAL_STATUSES.has(status);
}

export async function fetchReEmbedJob(
  courseId: string,
  jobId: string,
): Promise<ReEmbedJobResponse> {
  const response = await fetch(`/api/courses/${courseId}/re-embed/${jobId}`);
  const parsed = await readJsonResponse<{ job?: ReEmbedJobResponse; error?: string }>(response);

  if (!parsed.ok) {
    throw new Error(parsed.error);
  }

  if (!response.ok || !parsed.data.job) {
    throw new Error(parsed.data.error || "Failed to load processing status");
  }

  return parsed.data.job;
}

export async function pollReEmbedJobUntilDone(
  courseId: string,
  jobId: string,
  options?: {
    intervalMs?: number;
    onUpdate?: (job: ReEmbedJobResponse) => void;
  },
): Promise<ReEmbedJobResponse> {
  const intervalMs = options?.intervalMs ?? 2000;

  for (;;) {
    const job = await fetchReEmbedJob(courseId, jobId);
    options?.onUpdate?.(job);

    if (isReEmbedJobTerminal(job.status)) {
      return job;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export function formatReEmbedJobMessage(job: ReEmbedJobResponse): string {
  if (job.status === "FAILED") {
    return job.errorMessage || "Processing failed.";
  }
  if (job.status === "COMPLETED") {
    return `Processed ${job.processedCount} material(s).`;
  }
  if (job.status === "PARTIAL") {
    return (
      `Processed ${job.processedCount} of ${job.totalMaterials} material(s)` +
      (job.failed.length > 0 ? `; ${job.failed.length} failed` : "") +
      "."
    );
  }
  return "Processing…";
}
