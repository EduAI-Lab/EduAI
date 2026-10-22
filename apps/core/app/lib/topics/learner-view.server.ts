import type { Prisma } from "@prisma/client";

import { FALLBACK_TOPIC_NAME } from "~/lib/topics/fallback.server";

/**
 * The learner view of a course's topics (#1937): topics an instructor accepted
 * and has not hidden from students (#2002), minus the Uncategorized placeholder,
 * which exists so Question Maker always has something to author against and says
 * nothing about the course. Served by the `[courseId, reviewStatus]` index.
 *
 * Shared by the topics API and the student dashboard's topic count (#1962), so
 * the number a student is shown matches the list they get.
 */
export const LEARNER_TOPIC_WHERE = {
  reviewStatus: "ACCEPTED",
  visibleToStudents: true,
  name: { not: FALLBACK_TOPIC_NAME },
} satisfies Prisma.CourseTopicWhereInput;
