import { prisma } from "../config/database.js";
import { listEduAiCourseTopics } from "./eduaiClient.js";

/**
 * How long a successful auto-sync is trusted before the next GET /topics
 * read triggers another Core call for the same course. Only applies when
 * the caller opts in via `options.ttlMs` (the GET route's auto-sync path) —
 * an explicit POST .../sync call always hits Core. Keeps a page with many
 * concurrent viewers from firing a Core request per request.
 */
export const AUTO_SYNC_TTL_MS = 30_000;

/**
 * How long the read path (GET /topics) will wait on Core before giving up
 * and serving the local mirror. Without this, a Core that's up but slow or
 * hung doesn't throw — it just holds the socket — so every reader blocks on
 * Core's latency instead of degrading gracefully like a hard failure does.
 */
export const AUTO_SYNC_TIMEOUT_MS = 3_000;

const lastAutoSyncAt = new Map();

/** Forget a course's last sync so the next TTL-gated read pulls from Core again. */
export function invalidateTopicSync(courseOfferingId) {
  lastAutoSyncAt.delete(courseOfferingId);
}

function topicNames(topics) {
  return Array.from(
    new Set(
      topics
        .map((t) => (t && typeof t.name === "string" ? t.name.trim() : ""))
        .filter((n) => n.length > 0),
    ),
  );
}

/**
 * Sync topics from EduAI for an imported course into local DB.
 * - Ensures presence by name within the course offering, and marks which
 *   topics are in Core's learner view (`learnerVisible`, #1956).
 * - Deletes local topics Core no longer has (dismissed, merged, cleaned up),
 *   unless an activity still uses them; those stay, hidden from students.
 * - Returns the up-to-date list of local topics for the course.
 * - Pass `options.ttlMs` to skip the Core call (and just return the local
 *   mirror) if a sync for this course succeeded within the last `ttlMs` ms.
 * - Pass `options.signal` (e.g. `AbortSignal.timeout(AUTO_SYNC_TIMEOUT_MS)`)
 *   to bound the Core call; an abort surfaces like any other fetch failure
 *   and is tagged `phase: 'fetch'` below.
 * @param {number} courseOfferingId
 */
export async function syncExternalCourseTopics(courseOfferingId, options = {}) {
  if (!Number.isFinite(courseOfferingId)) return [];

  const course = await prisma.courseOffering.findUnique({ where: { id: courseOfferingId } });
  if (!course) return [];
  if (!course.coreOfferingId) {
    // Not an external course; nothing to sync
    const local = await prisma.topic.findMany({
      where: { courseOfferingId },
      orderBy: { name: "asc" },
    });
    return local;
  }

  if (options.ttlMs) {
    const lastSync = lastAutoSyncAt.get(courseOfferingId);
    if (lastSync && Date.now() - lastSync < options.ttlMs) {
      const local = await prisma.topic.findMany({
        where: { courseOfferingId },
        orderBy: { name: "asc" },
      });
      return { topics: local, upstreamNames: null, skipped: true };
    }
  }

  // Fetch both views from Core using the service key: the staff view is what
  // instructors author against, the learner view is what students may see.
  let externalTopics;
  let learnerTopics;
  try {
    [externalTopics, learnerTopics] = await Promise.all([
      listEduAiCourseTopics(course.coreOfferingId, { signal: options.signal }),
      listEduAiCourseTopics(course.coreOfferingId, {
        signal: options.signal,
        audience: "learner",
      }),
    ]);
  } catch (e) {
    e.phase = e.phase || "fetch";
    throw e;
  }
  const upstreamNames = topicNames(externalTopics);
  const learnerNames = topicNames(learnerTopics);

  if (upstreamNames.length === 0) {
    // Nothing to import, and nothing to prune: Core always has at least its
    // Uncategorized topic, so an empty list is not trusted for deletes.
    try {
      await prisma.topic.updateMany({
        where: { courseOfferingId, learnerVisible: true },
        data: { learnerVisible: false },
      });
    } catch (e) {
      e.phase = "write";
      throw e;
    }
    lastAutoSyncAt.set(courseOfferingId, Date.now());
    const local = await prisma.topic.findMany({
      where: { courseOfferingId },
      orderBy: { name: "asc" },
    });
    return { topics: local, upstreamNames: [] };
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Ensure existing topics by name; create missing ones
      const existing = await tx.topic.findMany({
        where: { courseOfferingId, name: { in: upstreamNames } },
        select: { name: true },
      });
      const have = new Set(existing.map((t) => t.name));
      const toCreate = upstreamNames.filter((n) => !have.has(n));
      if (toCreate.length > 0) {
        await tx.topic.createMany({
          data: toCreate.map((name) => ({ name, courseOfferingId })),
          skipDuplicates: true,
        });
      }

      await tx.topic.updateMany({
        where: { courseOfferingId, name: { in: learnerNames }, learnerVisible: false },
        data: { learnerVisible: true },
      });
      await tx.topic.updateMany({
        where: { courseOfferingId, name: { notIn: learnerNames }, learnerVisible: true },
        data: { learnerVisible: false },
      });

      // An activity's main topic is required, so a topic in use is kept.
      await tx.topic.deleteMany({
        where: {
          courseOfferingId,
          name: { notIn: upstreamNames },
          mainActivities: { none: {} },
          secondaryActivities: { none: {} },
        },
      });
    });
  } catch (e) {
    e.phase = "write";
    throw e;
  }

  lastAutoSyncAt.set(courseOfferingId, Date.now());

  const local = await prisma.topic.findMany({
    where: { courseOfferingId },
    orderBy: { name: "asc" },
  });
  return { topics: local, upstreamNames };
}
