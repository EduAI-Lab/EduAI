import { useState, useEffect, useCallback } from "react";

/** Where a topic came from (#1624). Mirrors the `TopicOrigin` Prisma enum. */
export type TopicOrigin = "HUMAN" | "SYSTEM" | "CANVAS_MODULE" | "MATERIAL_HEADING" | "AI";

/** Mirrors the `TopicReviewStatus` Prisma enum. */
export type TopicReviewStatus = "ACCEPTED" | "SUGGESTED";

/** One material a generated topic was derived from (#1624). */
export interface CourseTopicSource {
  materialId: string;
  /** Null when the material row no longer carries a readable title. */
  title: string | null;
}

export interface CourseTopic {
  id: string;
  courseId: string;
  name: string;
  /** #1624 provenance. Absent on responses from a pre-#1624 server. */
  origin?: TopicOrigin;
  reviewStatus?: TopicReviewStatus;
  confidence?: number | null;
  /** Bounded list of source materials; empty for human-created topics. */
  sources?: CourseTopicSource[];
  /** Total sources, which may exceed `sources.length` — the projection is capped. */
  sourceCount?: number;
  createdAt: string;
  updatedAt: string;
}

export function useCourseTopics(courseId: string) {
  const [topics, setTopics] = useState<CourseTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTopics = useCallback(async () => {
    if (!courseId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/courses/${courseId}/topics`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setTopics(data.topics);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch topics");
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    fetchTopics();
  }, [fetchTopics]);

  const createTopic = useCallback(
    async (name: string): Promise<CourseTopic> => {
      const res = await fetch(`/api/courses/${courseId}/topics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(await res.text());
      const topic = await res.json();
      setTopics((prev) => [...prev, topic]);
      return topic;
    },
    [courseId],
  );

  const deleteTopic = useCallback(
    async (topicId: string): Promise<void> => {
      const res = await fetch(`/api/courses/${courseId}/topics`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicId }),
      });
      if (!res.ok) throw new Error(await res.text());
      setTopics((prev) => prev.filter((t) => t.id !== topicId));
    },
    [courseId],
  );

  /**
   * Rename a topic through `PATCH /api/courses/:courseId/topics/:topicId`.
   *
   * The row is replaced from the response rather than patched locally: the
   * server trims the name and, for a renamed suggestion, may return other
   * changed fields, so echoing the request would drift from what was stored.
   */
  const editTopic = useCallback(
    async (topicId: string, name: string): Promise<CourseTopic> => {
      const res = await fetch(`/api/courses/${courseId}/topics/${topicId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(await res.text());
      const topic = (await res.json()) as CourseTopic;
      setTopics((prev) => prev.map((t) => (t.id === topicId ? topic : t)));
      return topic;
    },
    [courseId],
  );

  return { topics, loading, error, createTopic, deleteTopic, editTopic, refetch: fetchTopics };
}
