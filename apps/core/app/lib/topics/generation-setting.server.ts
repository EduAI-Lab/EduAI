import prisma from "~/lib/prisma.server";

/**
 * Whether a course generates topics from its materials (#1966).
 *
 * Read fresh on every call rather than cached: it is checked once per upload
 * batch and once per job run, and an instructor who just switched it off must
 * not have the next upload slip through on a stale value.
 *
 * A course that no longer exists reads as off, so a job left behind by a
 * deleted course does nothing.
 */
export async function isTopicGenerationEnabled(courseId: string): Promise<boolean> {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { topicGenerationEnabled: true },
  });
  return course?.topicGenerationEnabled ?? false;
}

export async function setTopicGenerationEnabled(courseId: string, enabled: boolean): Promise<void> {
  await prisma.course.update({
    where: { id: courseId },
    data: { topicGenerationEnabled: enabled },
  });
}
