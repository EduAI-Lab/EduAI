import prisma from "~/lib/prisma.server";
import {
  buildCourseListFilter,
  resolveCourseAccessGate,
  type RbacUser,
} from "~/lib/auth/course-access.server";
import { getCourseTopics, getCourseTopic } from "~/lib/courses/server";

const COURSE_LIST_SELECT = {
  id: true,
  code: true,
  name: true,
  section: true,
  term: true,
  year: true,
  department: true,
  isPublished: true,
} as const;

const COURSE_DETAIL_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  section: true,
  term: true,
  year: true,
  department: true,
  isPublished: true,
  startDate: true,
  endDate: true,
  aiInstructions: true,
} as const;

const TOPIC_SELECT = {
  id: true,
  courseId: true,
  name: true,
  createdAt: true,
  updatedAt: true,
} as const;

type ToolError = { error: string };

async function requireCourseAccess(
  user: RbacUser,
  courseId: string,
): Promise<{ course: NonNullable<Awaited<ReturnType<typeof resolveCourseAccessGate>>["course"]> } | ToolError> {
  const { course, access } = await resolveCourseAccessGate(user, courseId);
  if (!course) {
    return { error: "COURSE_NOT_FOUND" };
  }
  if (!access || (access.level === "student" && !course.isPublished)) {
    return { error: "Forbidden" };
  }
  return { course };
}

/** Same RBAC as GET /api/courses — user-scoped course list. */
export async function listAccessibleCourses(user: RbacUser) {
  const courses = await prisma.course.findMany({
    where: await buildCourseListFilter(user),
    select: COURSE_LIST_SELECT,
    orderBy: { code: "asc" },
  });
  return { courses };
}

/** Same RBAC as GET /api/courses/:id. */
export async function getAccessibleCourse(user: RbacUser, courseId: string) {
  const gate = await requireCourseAccess(user, courseId);
  if ("error" in gate) {
    return gate;
  }

  const course = await prisma.course.findFirst({
    where: { id: courseId, deletedAt: null },
    select: COURSE_DETAIL_SELECT,
  });
  if (!course) {
    return { error: "COURSE_NOT_FOUND" };
  }
  return { course };
}

/** Same RBAC as GET /api/courses/:id/topics. */
export async function listAccessibleCourseTopics(user: RbacUser, courseId: string) {
  const gate = await requireCourseAccess(user, courseId);
  if ("error" in gate) {
    return gate;
  }

  const topics = await getCourseTopics(courseId);
  return {
    topics: topics.map(({ id, courseId: cid, name, createdAt, updatedAt }) => ({
      id,
      courseId: cid,
      name,
      createdAt,
      updatedAt,
    })),
  };
}

/** Same RBAC as GET /api/courses/:id/topics/:topicId. */
export async function getAccessibleCourseTopic(
  user: RbacUser,
  courseId: string,
  topicId: string,
) {
  const gate = await requireCourseAccess(user, courseId);
  if ("error" in gate) {
    return gate;
  }

  const topic = await getCourseTopic(courseId, topicId);
  if (!topic) {
    return { error: "TOPIC_NOT_FOUND" };
  }

  return {
    topic: {
      id: topic.id,
      courseId: topic.courseId,
      name: topic.name,
      createdAt: topic.createdAt,
      updatedAt: topic.updatedAt,
    },
  };
}

export type { ToolError };
