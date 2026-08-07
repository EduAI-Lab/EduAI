export type ReEmbedJobTerminalStatus = "COMPLETED" | "PARTIAL";

/** Maps material re-embed counts to a terminal job status. */
export function resolveReEmbedJobStatus(result: {
  processed: number;
  failed: string[];
  total: number;
}): ReEmbedJobTerminalStatus {
  if (result.total === 0) return "COMPLETED";
  if (result.failed.length > 0) return "PARTIAL";
  if (result.processed === result.total) return "COMPLETED";
  return "PARTIAL";
}
