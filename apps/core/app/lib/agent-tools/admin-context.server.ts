import prisma from "~/lib/prisma.server";
import type { RbacUser } from "~/lib/auth/course-access.server";
import { listAccessibleCourses, getAccessibleCourse, listAccessibleCourseTopics, getAccessibleCourseTopic } from "./course-context.server";
import { listBugReports } from "~/lib/bug-reports/server";

type ToolError = { error: string; fields?: Record<string, string> };

/**
 * Keep list/tool payloads small enough for 16k-context admin chat multi-step
 * turns (delete → listUsers previously returned 200 rows and blew the window).
 */
const DEFAULT_LIST_LIMIT = 25;
const MAX_LIST_LIMIT = 50;

function requirePlatformAdmin(user: RbacUser): ToolError | null {
  if (user.role !== "ADMIN") {
    return { error: "Forbidden" };
  }
  return null;
}

function parseOptionalDate(value: string | undefined, field: string): Date | null | ToolError {
  if (value === undefined || value.trim() === "") {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { error: "VALIDATION_ERROR", fields: { [field]: "invalid ISO date" } };
  }
  return parsed;
}

function adminToolPayload<T extends Record<string, unknown>>(data: T) {
  return {
    dataSource: "database" as const,
    queriedAt: new Date().toISOString(),
    ...data,
  };
}

/** Resolve a course id from id, code, or UI fallback (admin enrollment tools). */
export async function resolveAdminCourseId(
  user: RbacUser,
  opts: {
    courseId?: string;
    courseCode?: string;
    fallbackCourseId?: string | null;
  },
): Promise<{ courseId: string; courseCode: string } | ToolError> {
  const tryId = async (id: string | undefined | null) => {
    if (!id?.trim()) return null;
    const gate = await getAccessibleCourse(user, id.trim());
    if ("error" in gate) {
      return gate;
    }
    return { courseId: gate.course.id, courseCode: gate.course.code };
  };

  const byId = await tryId(opts.courseId);
  if (byId && "error" in byId) {
    return byId;
  }
  if (byId) {
    return byId;
  }

  const byFallback = await tryId(opts.fallbackCourseId);
  if (byFallback && "error" in byFallback) {
    return byFallback;
  }
  if (byFallback) {
    return byFallback;
  }

  const code = opts.courseCode?.trim();
  if (code) {
    const course = await prisma.course.findFirst({
      where: { code, deletedAt: null },
      select: { id: true, code: true },
      orderBy: { updatedAt: "desc" },
    });
    if (!course) {
      return { error: "COURSE_NOT_FOUND" };
    }
    const gate = await getAccessibleCourse(user, course.id);
    if ("error" in gate) {
      return gate;
    }
    return { courseId: course.id, courseCode: course.code };
  }

  return { error: "courseId or courseCode required" };
}

/** ADMIN-only user directory (read-only). */
export async function listAdminUsers(user: RbacUser, limit = DEFAULT_LIST_LIMIT) {
  const denied = requirePlatformAdmin(user);
  if (denied) return denied;

  const clampedLimit = Math.min(Math.max(Math.floor(limit), 1), MAX_LIST_LIMIT);

  const where = {};
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: clampedLimit,
    }),
    prisma.user.count({ where }),
  ]);

  return adminToolPayload({
    users,
    count: users.length,
    total,
    truncated: users.length < total,
  });
}

/** Course enrollments with optional enrolledAt window (TA+ course access). */
export async function listAdminCourseEnrollments(
  user: RbacUser,
  courseId: string,
  opts: {
    enrolledSince?: string;
    enrolledBefore?: string;
    isActive?: boolean;
    limit?: number;
  } = {},
) {
  const enrolledSince = opts.enrolledSince
    ? parseOptionalDate(opts.enrolledSince, "enrolledSince")
    : null;
  if (enrolledSince && "error" in enrolledSince) {
    return enrolledSince;
  }

  const enrolledBefore = opts.enrolledBefore
    ? parseOptionalDate(opts.enrolledBefore, "enrolledBefore")
    : null;
  if (enrolledBefore && "error" in enrolledBefore) {
    return enrolledBefore;
  }

  const gate = await getAccessibleCourse(user, courseId);
  if ("error" in gate) {
    return gate;
  }

  const clampedLimit = Math.min(
    Math.max(Math.floor(opts.limit ?? DEFAULT_LIST_LIMIT), 1),
    MAX_LIST_LIMIT,
  );

  const enrolledAtFilter =
    enrolledSince instanceof Date || enrolledBefore instanceof Date
      ? {
          ...(enrolledSince instanceof Date ? { gte: enrolledSince } : {}),
          ...(enrolledBefore instanceof Date ? { lte: enrolledBefore } : {}),
        }
      : undefined;

  const where = {
    courseId,
    ...(typeof opts.isActive === "boolean" ? { isActive: opts.isActive } : {}),
    ...(enrolledAtFilter ? { enrolledAt: enrolledAtFilter } : {}),
  };

  const [enrollments, total] = await Promise.all([
    prisma.enrollment.findMany({
      where,
      include: {
        user: { select: { email: true, name: true } },
      },
      orderBy: { enrolledAt: "desc" },
      take: clampedLimit,
    }),
    prisma.enrollment.count({ where }),
  ]);

  return adminToolPayload({
    courseId,
    courseCode: gate.course.code,
    enrollments: enrollments.map((e) => ({
      enrollmentId: e.id,
      userId: e.userId,
      studentEmail: e.user.email,
      studentName: e.user.name,
      role: e.role,
      isActive: e.isActive,
      enrolledAt: e.enrolledAt?.toISOString() ?? null,
    })),
    count: enrollments.length,
    total,
    truncated: enrollments.length < total,
  });
}

/** ADMIN course topic list — same RBAC as GET /api/courses/:id/topics. */
export async function listAdminCourseTopics(user: RbacUser, courseId: string) {
  const gate = await getAccessibleCourse(user, courseId);
  if ("error" in gate) {
    return gate;
  }

  const result = await listAccessibleCourseTopics(user, courseId);
  if ("error" in result) {
    return result;
  }

  return adminToolPayload({
    courseId,
    courseCode: gate.course.code,
    topics: result.topics,
    count: result.topics.length,
  });
}

/** ADMIN single course topic — same RBAC as GET /api/courses/:id/topics/:topicId. */
export async function getAdminCourseTopic(
  user: RbacUser,
  courseId: string,
  topicId: string,
) {
  const gate = await getAccessibleCourse(user, courseId);
  if ("error" in gate) {
    return gate;
  }

  const result = await getAccessibleCourseTopic(user, courseId, topicId);
  if ("error" in result) {
    return result;
  }

  return adminToolPayload({
    courseId,
    courseCode: gate.course.code,
    topic: result.topic,
  });
}

/** ADMIN-only bug report triage list (read-only). */
export async function listAdminBugReportsForChat(
  user: RbacUser,
  opts: {
    status?: "UNHANDLED" | "IN_PROGRESS" | "RESOLVED";
    source?: "CORE" | "AI_TUTOR" | "QUESTION_MAKER";
    limit?: number;
  } = {},
) {
  const denied = requirePlatformAdmin(user);
  if (denied) return denied;

  const result = await listBugReports({
    status: opts.status,
    source: opts.source,
    limit: opts.limit ?? 50,
    offset: 0,
  });

  return adminToolPayload({
    reports: result.reports.map((r) => ({
      id: r.id,
      source: r.source,
      status: r.status,
      description: r.description,
      userEmail: r.userEmail,
      userName: r.userName,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    count: result.reports.length,
    total: result.total,
    truncated: result.reports.length < result.total,
  });
}

/** Resolve a platform user id from id or email (ADMIN write tools). */
export async function resolveAdminUserId(
  user: RbacUser,
  opts: { userId?: string; userEmail?: string },
): Promise<{ userId: string; email: string; name: string } | ToolError> {
  const denied = requirePlatformAdmin(user);
  if (denied) return denied;

  const id = opts.userId?.trim();
  if (id) {
    const found = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, name: true },
    });
    if (!found) {
      return { error: "USER_NOT_FOUND", fields: { userId: "no user with this id" } };
    }
    return { userId: found.id, email: found.email, name: found.name };
  }

  const email = opts.userEmail?.trim().toLowerCase();
  if (email) {
    const found = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true, email: true, name: true },
    });
    if (!found) {
      return { error: "USER_NOT_FOUND", fields: { userEmail: "no user with this email" } };
    }
    return { userId: found.id, email: found.email, name: found.name };
  }

  return { error: "VALIDATION_ERROR", fields: { user: "userId or userEmail required" } };
}

export { listAccessibleCourses, getAccessibleCourse };
