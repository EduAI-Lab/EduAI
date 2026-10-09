import prisma from "~/lib/prisma.server";
import { ensureCourseHasTopic, type DbClient } from "~/lib/topics/fallback.server";

/**
 * Remove unreviewed suggestions whose every source material is now deleted (#1937).
 *
 * Called in the same transaction as a material delete, so a suggestion never
 * outlives the only file it was read from. Course-wide rather than scoped to the
 * one material, so orphans left by deletes made before this existed are cleared
 * on the course's next delete too.
 *
 * A hard delete, unlike dismissing: topic names are unique per course including
 * soft-deleted rows, and the generator skips any name already taken, so a soft
 * delete would stop a revised upload of the same file ever suggesting the topic
 * again. Nothing a person decided is lost — accepted topics, dismissals
 * (already soft-deleted) and anything a question uses are all excluded.
 */
export async function removeOrphanedSuggestions(
  courseId: string,
  db: DbClient = prisma,
): Promise<number> {
  const { count } = await db.courseTopic.deleteMany({
    where: {
      courseId,
      reviewStatus: "SUGGESTED",
      deletedAt: null,
      // `some` because `every` alone is true for a topic with no sources, such as
      // one from a Canvas module with no files, which no material delete orphans.
      sources: { some: {}, every: { material: { deletedAt: { not: null } } } },
      // Soft-deleted questions still hold the foreign key, so `none` means none at all.
      questions: { none: {} },
      secondaryTopics: { none: {} },
    },
  });

  if (count > 0) await ensureCourseHasTopic(courseId, db);
  return count;
}
