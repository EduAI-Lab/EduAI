import { Prisma } from "@prisma/client";

import prisma from "~/lib/prisma.server";

type DbClient = typeof prisma | Prisma.TransactionClient;

/**
 * The reserved name of the zero-topic fallback (#1624). Question Maker requires
 * a topic to author against, so a course must never be left with none —
 * otherwise a background job that is merely slow, or one that failed, becomes a
 * hard authoring blocker.
 */
export const FALLBACK_TOPIC_NAME = "Uncategorized";

/**
 * Guarantee the course has at least one topic to author against.
 *
 * Idempotent and safe to call from anywhere: it creates the fallback only when
 * the course has no live topics at all, and swallows the unique-constraint race
 * two concurrent callers can lose. Returns whether it created the topic.
 *
 * Deliberately checks for *any* live topic rather than for the fallback by name:
 * once real topics exist the fallback has no reason to be created, and once an
 * instructor deletes an unused fallback it should not silently come back.
 */
export async function ensureCourseHasTopic(
  courseId: string,
  db: DbClient = prisma,
): Promise<boolean> {
  const existing = await db.courseTopic.findFirst({
    where: { courseId, deletedAt: null },
    select: { id: true },
  });
  if (existing) return false;

  try {
    await db.courseTopic.create({
      data: {
        courseId,
        name: FALLBACK_TOPIC_NAME,
        origin: "SYSTEM",
        // ACCEPTED, not SUGGESTED: this is not a proposal about the course's
        // subject matter, so there is nothing for an instructor to review.
        reviewStatus: "ACCEPTED",
        createdBy: null,
      },
    });
    return true;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // The name is taken. Either a concurrent caller won the race — in which case
    // a live topic now exists and there is nothing to do — or the row is there
    // but soft-deleted, which would leave the course with zero live topics and
    // break this function's whole contract. Restore it in that case: unlike a
    // generated suggestion, whose dismissal must stick, the fallback exists
    // precisely so authoring is never blocked, and we only reach here when it is.
    return restoreSoftDeletedFallback(courseId, db);
  }
}

async function restoreSoftDeletedFallback(
  courseId: string,
  db: DbClient = prisma,
): Promise<boolean> {
  const { count } = await db.courseTopic.updateMany({
    where: { courseId, name: FALLBACK_TOPIC_NAME, deletedAt: { not: null } },
    data: { deletedAt: null, deletedBy: null },
  });
  return count > 0;
}

function isUniqueViolation(cause: unknown): boolean {
  return cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002";
}
