/**
 * Linking a file to a topic from the topic's side (#1997). The server only
 * offers "replace this file's topics", so these turn "add / remove one topic"
 * into the full ordered list to save. Client-safe.
 */
import type { MaterialTopic, MaterialTopicChoice } from "~/hooks/api/use-course-materials";
import { MAX_TOPICS_PER_MATERIAL } from "~/lib/topics/candidates";

export function hasTopic(topics: readonly MaterialTopic[], topicId: string): boolean {
  return topics.some((topic) => topic.id === topicId);
}

/**
 * The file's topics with `topicId` added last, so its main topic stays its main
 * topic. Null when the file is already at the cap; unchanged if already there.
 */
export function topicsWithAdded(
  topics: readonly MaterialTopic[],
  topicId: string,
): MaterialTopicChoice[] | null {
  const kept = topics.map((topic) => ({ topicId: topic.id }));
  if (hasTopic(topics, topicId)) return kept;
  if (topics.length >= MAX_TOPICS_PER_MATERIAL) return null;
  return [...kept, { topicId }];
}

/** The file's topics without `topicId`, the rest in their order. */
export function topicsWithRemoved(
  topics: readonly MaterialTopic[],
  topicId: string,
): MaterialTopicChoice[] {
  return topics.filter((topic) => topic.id !== topicId).map((topic) => ({ topicId: topic.id }));
}
