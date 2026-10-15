import prisma from "~/lib/prisma.server";
import { resolveCourseAccessGate } from "~/lib/auth/course-access.server";
import type { HybridRagHit, RagExcerptHeader } from "~/lib/chat-rag";
import { LEARNER_TOPIC_WHERE } from "~/lib/topics/learner-view.server";

/**
 * What a student's course chat may say about where an answer came from (#1963):
 * the accepted topics a retrieved file belongs to (the #1937 learner view),
 * never the file's title. Staff turns keep file titles; nothing here runs for them.
 *
 * Every helper fails closed: a hit with no material, a material with no accepted
 * topic, or a failed lookup yields no topic — never the file title.
 */

/** A retrieved excerpt as a student's getInformation result carries it. */
export type LearnerRagHit = { content: string; similarity: number; topics: string[] };

/** Accepted topic names per material, for the materials one turn retrieved. */
export type LearnerTopicsByMaterial = ReadonlyMap<string, readonly string[]>;

/** Excerpt header for a material with no accepted topic: says what it is without naming it. */
export const LEARNER_EXCERPT_FALLBACK_HEADER = "**Source**: Course material\n";

const NO_TOPICS: readonly string[] = [];

function topicsFor(hit: HybridRagHit, topicsByMaterial: LearnerTopicsByMaterial) {
  return hit.materialId ? (topicsByMaterial.get(hit.materialId) ?? NO_TOPICS) : NO_TOPICS;
}

/**
 * One query for every material the turn retrieved (a handful — retrieval caps
 * hits per call), served by `course_topic_sources(materialId)`.
 */
export async function loadLearnerTopicsByMaterial(
  courseId: string,
  hits: readonly HybridRagHit[],
): Promise<LearnerTopicsByMaterial> {
  const materialIds = [...new Set(hits.flatMap((hit) => (hit.materialId ? [hit.materialId] : [])))];
  if (materialIds.length === 0) return new Map();

  try {
    const rows = await prisma.courseTopicSource.findMany({
      where: {
        materialId: { in: materialIds },
        topic: { courseId, deletedAt: null, ...LEARNER_TOPIC_WHERE },
      },
      select: { materialId: true, topic: { select: { name: true } } },
      orderBy: { topic: { name: "asc" } },
    });
    const topicsByMaterial = new Map<string, string[]>();
    for (const row of rows) {
      const names = topicsByMaterial.get(row.materialId) ?? [];
      names.push(row.topic.name);
      topicsByMaterial.set(row.materialId, names);
    }
    return topicsByMaterial;
  } catch (error) {
    // A missing topic line beats a failed answer, and it still names no file.
    console.error("[learner-sources] topic lookup failed", { courseId, error });
    return new Map();
  }
}

/** The topics these excerpts cover, each once, in first-seen order: a student's "Topics:" line. */
export function learnerTopicLabels(
  hits: readonly HybridRagHit[],
  topicsByMaterial: LearnerTopicsByMaterial,
): string[] {
  const labels: string[] = [];
  for (const hit of hits) {
    for (const name of topicsFor(hit, topicsByMaterial)) {
      if (!labels.includes(name)) labels.push(name);
    }
  }
  return labels;
}

/** Excerpt headers for a student's prompt: topics, or a neutral label — so the model has no file name to repeat. */
export function learnerExcerptHeader(topicsByMaterial: LearnerTopicsByMaterial): RagExcerptHeader {
  return (hit) => {
    const topics = topicsFor(hit, topicsByMaterial);
    return topics.length > 0
      ? `**Topics**: ${topics.join(", ")}\n`
      : LEARNER_EXCERPT_FALLBACK_HEADER;
  };
}

/** A student's getInformation result: the same excerpts, with topics in place of file titles. */
export function toLearnerRagHits(
  hits: readonly HybridRagHit[],
  topicsByMaterial: LearnerTopicsByMaterial,
): LearnerRagHit[] {
  return hits.map((hit) => ({
    content: hit.content,
    similarity: hit.similarity,
    topics: [...topicsFor(hit, topicsByMaterial)],
  }));
}

/**
 * Whether a transcript reader may see course file names (#1963). Admins and staff
 * overseeing a student's chat do. An owner is checked against the chat's course,
 * because the same platform role can be a student in one course and a TA in
 * another; an owner who is a student there — or has lost access — does not.
 *
 * Every turn of a chat runs in its course (chat.ts rejects a mismatched course),
 * so the chat's course decides. One with no course left — the course was deleted
 * and the FK set null — fails closed: nobody can tell any more who the owner was.
 */
export async function readerSeesMaterialFiles(
  viewer: { id: string; role?: string | null },
  access: { isOwner: boolean; chat: { courseId: string | null } },
): Promise<boolean> {
  if (viewer.role === "ADMIN" || !access.isOwner) return true;
  if (!access.chat.courseId) return false;
  const { access: courseAccess } = await resolveCourseAccessGate(viewer, access.chat.courseId);
  return courseAccess !== null && courseAccess.level !== "student";
}
