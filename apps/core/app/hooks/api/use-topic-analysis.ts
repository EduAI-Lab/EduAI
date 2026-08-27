import { useCallback, useEffect, useState } from "react";

export type TopicAnalysisJob = {
  id: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  created: number | null;
  usedSource: string | null;
};

export type TopicAnalysisStatus = {
  job: TopicAnalysisJob | null;
  pendingSuggestions: number;
};

/** The four bodies the topic-analysis action accepts. Mirrors its Zod schema. */
export type TopicReviewRequest =
  | { action: "approve" | "dismiss"; topicId: string }
  | { action: "merge"; topicId: string; intoTopicId: string }
  | { action: "retry" };

const EMPTY: TopicAnalysisStatus = { job: null, pendingSuggestions: 0 };

/** Poll interval while a job is still in flight. */
const IN_FLIGHT_POLL_MS = 5000;

/**
 * Automatic topic provisioning status for a course (#1624).
 *
 * Polls only while the job is actually running: a completed or failed job is
 * terminal, and its row is the persistent record the banner reads, so there is
 * nothing to poll for once it settles.
 *
 * A failed request resolves to the empty status rather than surfacing an error —
 * this drives a supplementary banner, and a status endpoint being briefly
 * unavailable should not put an error in front of an instructor who was doing
 * something else entirely.
 */
export function useTopicAnalysis(courseId: string, enabled = true) {
  const [status, setStatus] = useState<TopicAnalysisStatus>(EMPTY);
  const [loading, setLoading] = useState(enabled);

  const fetchStatus = useCallback(async () => {
    if (!courseId || !enabled) return;
    try {
      const res = await fetch(`/api/courses/${courseId}/topic-analysis`);
      if (!res.ok) throw new Error(await res.text());
      setStatus((await res.json()) as TopicAnalysisStatus);
    } catch {
      setStatus(EMPTY);
    } finally {
      setLoading(false);
    }
  }, [courseId, enabled]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const inFlight = status.job?.status === "PENDING" || status.job?.status === "RUNNING";

  useEffect(() => {
    if (!inFlight) return;
    const timer = setInterval(fetchStatus, IN_FLIGHT_POLL_MS);
    return () => clearInterval(timer);
  }, [inFlight, fetchStatus]);

  const post = useCallback(
    async (body: TopicReviewRequest): Promise<void> => {
      const res = await fetch(`/api/courses/${courseId}/topic-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      await fetchStatus();
    },
    [courseId, fetchStatus],
  );

  const approveTopic = useCallback(
    (topicId: string) => post({ action: "approve", topicId }),
    [post],
  );
  const dismissTopic = useCallback(
    (topicId: string) => post({ action: "dismiss", topicId }),
    [post],
  );
  const mergeTopic = useCallback(
    (topicId: string, intoTopicId: string) => post({ action: "merge", topicId, intoTopicId }),
    [post],
  );
  const retryAnalysis = useCallback(() => post({ action: "retry" }), [post]);

  return {
    status,
    loading,
    inFlight,
    approveTopic,
    dismissTopic,
    mergeTopic,
    retryAnalysis,
    refetch: fetchStatus,
  };
}
