import prisma from "~/lib/prisma.server";
import type { RbacUser } from "~/lib/auth/course-access.server";
import { listAccessibleCourses, getAccessibleCourse } from "./course-context.server";
import { listBugReports } from "~/lib/bug-reports/server";

type ToolError = { error: string; fields?: Record<string, string> };

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

/** ADMIN-only user directory (read-only). */
export async function listAdminUsers(user: RbacUser) {
  const denied = requirePlatformAdmin(user);
  if (denied) return denied;

  const users = await prisma.user.findMany({
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
    take: 200,
  });

  return { users, count: users.length };
}

/** Course enrollments with optional enrolledAt window (TA+ course access). */
export async function listAdminCourseEnrollments(
  user: RbacUser,
  courseId: string,
  opts: {
    enrolledSince?: string;
    enrolledBefore?: string;
    isActive?: boolean;
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

  const enrollments = await prisma.enrollment.findMany({
    where: {
      courseId,
      ...(typeof opts.isActive === "boolean" ? { isActive: opts.isActive } : {}),
      ...(enrolledSince instanceof Date ? { enrolledAt: { gte: enrolledSince } } : {}),
      ...(enrolledBefore instanceof Date ? { enrolledAt: { lte: enrolledBefore } } : {}),
    },
    include: {
      user: { select: { email: true, name: true } },
    },
    orderBy: { enrolledAt: "desc" },
    take: 200,
  });

  return {
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
  };
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

  return {
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
    total: result.total,
  };
}

export { listAccessibleCourses, getAccessibleCourse };
