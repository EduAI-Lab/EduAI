import { Prisma } from "@prisma/client";
import type { EnrollmentRole } from "@prisma/client";
import prisma from "~/lib/prisma.server";
import type { RbacUser } from "~/lib/auth/course-access.server";
import { createUserSchema, updateUserSchema } from "~/lib/auth/schemas";
import {
  addEnrollment,
  deactivateEnrollment,
  updateEnrollmentRole,
} from "~/lib/courses/enrollments.server";
import { updateBugReportStatus } from "~/lib/bug-reports/server";
import { getAccessibleCourse, resolveAdminCourseId } from "./admin-context.server";

type ToolError = { error: string; fields?: Record<string, string> };
type MutationResult = Record<string, unknown> | ToolError;

function requirePlatformAdmin(user: RbacUser): ToolError | null {
  if (user.role !== "ADMIN") {
    return { error: "Forbidden" };
  }
  return null;
}

function mutationPayload(data: Record<string, unknown>) {
  return {
    dataSource: "database" as const,
    mutation: true as const,
    appliedAt: new Date().toISOString(),
    ...data,
  };
}

function mapEnrollmentResult(
  result: Awaited<
    ReturnType<typeof addEnrollment | typeof updateEnrollmentRole | typeof deactivateEnrollment>
  >,
) {
  if ("status" in result) {
    if (result.status === "422" && "error" in result) {
      return { error: result.error, fields: "fields" in result ? result.fields : undefined };
    }
    if (result.status === "409" && "error" in result) {
      return {
        error: result.error,
        ...("currentInstructorCount" in result
          ? { currentInstructorCount: result.currentInstructorCount }
          : {}),
      };
    }
    if (result.status === "404") {
      return { error: "NOT_FOUND" };
    }
    if (result.status === "201" || result.status === "200") {
      return mutationPayload({
        ok: true,
        enrollment: "enrollment" in result ? result.enrollment : undefined,
        previousRole: "previousRole" in result ? result.previousRole : undefined,
      });
    }
    if (result.status === "204") {
      return mutationPayload({
        ok: true,
        role: "role" in result ? result.role : undefined,
      });
    }
  }
  return { error: "UNKNOWN" };
}

/** ADMIN — create platform user (same validation as POST /api/users). */
export async function createAdminUser(
  actor: RbacUser,
  input: {
    name: string;
    email: string;
    role: "ADMIN" | "UNIT_ADMIN" | "INSTRUCTOR" | "TA" | "STUDENT";
    isActive?: boolean;
  },
): Promise<MutationResult> {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const parsed = createUserSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "VALIDATION_ERROR",
      fields: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path.join(".") || "body", i.message]),
      ),
    };
  }

  try {
    const user = await prisma.user.create({
      data: {
        ...parsed.data,
        emailVerified: false,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });
    return mutationPayload({ ok: true, user });
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { error: "EMAIL_ALREADY_EXISTS" };
    }
    throw error;
  }
}

/** ADMIN — update platform user (same guards as PATCH /api/users). */
export async function updateAdminUser(
  actor: RbacUser,
  userId: string,
  input: Record<string, unknown>,
): Promise<MutationResult> {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  if (userId === actor.id) {
    if (input.isActive === false) {
      return { error: "CANNOT_DEACTIVATE_SELF" };
    }
    if (input.role !== undefined && input.role !== actor.role) {
      return { error: "CANNOT_CHANGE_OWN_ROLE" };
    }
  }

  const parsed = updateUserSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "VALIDATION_ERROR",
      fields: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path.join(".") || "body", i.message]),
      ),
    };
  }

  if (parsed.data.authorizedUnits !== undefined) {
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!target) {
      return { error: "USER_NOT_FOUND" };
    }
    const effectiveRole = parsed.data.role ?? target.role;
    if (effectiveRole !== "UNIT_ADMIN") {
      return { error: "ROLE_MISMATCH" };
    }
  }

  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data: parsed.data,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        authorizedUnits: true,
        updatedAt: true,
      },
    });
    return mutationPayload({ ok: true, user });
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return { error: "USER_NOT_FOUND" };
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { error: "EMAIL_ALREADY_EXISTS" };
    }
    throw error;
  }
}

/** ADMIN — delete platform user (same guards as DELETE /api/users). */
export async function deleteAdminUser(actor: RbacUser, userId: string): Promise<MutationResult> {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  if (userId === actor.id) {
    return { error: "CANNOT_DELETE_SELF" };
  }

  try {
    await prisma.user.delete({ where: { id: userId } });
    return mutationPayload({ ok: true, deletedUserId: userId });
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return { error: "USER_NOT_FOUND" };
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      return { error: "CANNOT_DELETE_USER_WITH_DATA" };
    }
    throw error;
  }
}

/** ADMIN — enroll a user in a course. */
export async function createAdminEnrollment(
  actor: RbacUser,
  opts: {
    courseId?: string;
    courseCode?: string;
    fallbackCourseId?: string | null;
    userId: string;
    role: EnrollmentRole;
  },
): Promise<MutationResult> {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const resolved = await resolveAdminCourseId(actor, {
    courseId: opts.courseId,
    courseCode: opts.courseCode,
    fallbackCourseId: opts.fallbackCourseId,
  });
  if ("error" in resolved) {
    return resolved;
  }

  const gate = await getAccessibleCourse(actor, resolved.courseId);
  if ("error" in gate) {
    return gate;
  }

  return mapEnrollmentResult(
    await addEnrollment(resolved.courseId, {
      userId: opts.userId,
      role: opts.role,
    }),
  );
}

/** ADMIN — change enrollment role. */
export async function updateAdminEnrollmentRole(
  actor: RbacUser,
  opts: {
    courseId?: string;
    courseCode?: string;
    fallbackCourseId?: string | null;
    enrollmentId: string;
    role: EnrollmentRole;
  },
): Promise<MutationResult> {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const resolved = await resolveAdminCourseId(actor, {
    courseId: opts.courseId,
    courseCode: opts.courseCode,
    fallbackCourseId: opts.fallbackCourseId,
  });
  if ("error" in resolved) {
    return resolved;
  }

  return mapEnrollmentResult(
    await updateEnrollmentRole(resolved.courseId, opts.enrollmentId, {
      role: opts.role,
    }),
  );
}

/** ADMIN — deactivate (soft-delete) an enrollment. */
export async function deactivateAdminEnrollment(
  actor: RbacUser,
  opts: {
    courseId?: string;
    courseCode?: string;
    fallbackCourseId?: string | null;
    enrollmentId: string;
  },
): Promise<MutationResult> {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const resolved = await resolveAdminCourseId(actor, {
    courseId: opts.courseId,
    courseCode: opts.courseCode,
    fallbackCourseId: opts.fallbackCourseId,
  });
  if ("error" in resolved) {
    return resolved;
  }

  return mapEnrollmentResult(
    await deactivateEnrollment(resolved.courseId, opts.enrollmentId),
  );
}

/** ADMIN — update bug report triage status. */
export async function updateAdminBugReportStatus(
  actor: RbacUser,
  reportId: string,
  status: "UNHANDLED" | "IN_PROGRESS" | "RESOLVED",
): Promise<MutationResult> {
  const denied = requirePlatformAdmin(actor);
  if (denied) return denied;

  const updated = await updateBugReportStatus(reportId, status);
  if (!updated) {
    return { error: "NOT_FOUND" };
  }
  return mutationPayload({ ok: true, report: updated });
}
