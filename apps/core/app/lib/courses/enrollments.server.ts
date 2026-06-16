import type { EnrollmentRole } from "@prisma/client";
import prisma from "~/lib/prisma.server";

const ENROLLMENT_ROLES = ["STUDENT", "TA", "INSTRUCTOR"] as const;

export function isEnrollmentRole(value: unknown): value is EnrollmentRole {
  return typeof value === "string" && (ENROLLMENT_ROLES as readonly string[]).includes(value);
}

/**
 * Returns all enrollments (active and inactive) for a course,
 * joined with user data to provide studentEmail and studentName.
 *
 * Does NOT filter by isActive — AI Tutor's enrollmentSync.js
 * handles that filtering on its side. Ordered by enrolledAt ascending.
 */
export async function getCourseEnrollments(courseId: string) {
  return prisma.enrollment.findMany({
    where: { courseId },
    // Join user to populate studentEmail and studentName in the response
    include: {
      user: {
        select: {
          email: true,
          name: true,
        },
      },
    },
    orderBy: { enrolledAt: "asc" },
  });
}

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * §6 instructor-floor invariant: a course must always retain >= 1 active
 * INSTRUCTOR enrollment. Returns a 409 result when `enrollment` is the last
 * active instructor and the operation would demote/deactivate it. Applies to
 * EVERY caller including ADMIN — there is no override. Runs inside the
 * mutation's transaction so the check-then-write is atomic.
 */
async function instructorFloorViolation(
  tx: TxClient,
  enrollment: {
    courseId: string;
    role: EnrollmentRole;
    isActive: boolean;
  },
) {
  if (enrollment.role !== "INSTRUCTOR" || !enrollment.isActive) return null;
  const currentInstructorCount = await tx.enrollment.count({
    where: { courseId: enrollment.courseId, role: "INSTRUCTOR", isActive: true },
  });
  if (currentInstructorCount <= 1) {
    return {
      status: "409",
      error: "INSTRUCTOR_FLOOR_VIOLATION",
      currentInstructorCount,
    } as const;
  }
  return null;
}

/**
 * POST /api/courses/:id/enrollments — add a user to a course with a role.
 * Promotions of existing rows go through updateEnrollmentRole (the unique
 * [courseId, userId] constraint 409s INSERTs by design, §6).
 */
export async function addEnrollment(
  courseId: string,
  payload: { userId?: unknown; role?: unknown },
) {
  if (typeof payload.userId !== "string" || !payload.userId || !isEnrollmentRole(payload.role)) {
    return { status: "400" } as const;
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true },
  });
  if (!user) {
    return { status: "422", error: "USER_NOT_FOUND" } as const;
  }

  try {
    const enrollment = await prisma.enrollment.create({
      data: { courseId, userId: payload.userId, role: payload.role, isActive: true },
    });
    return { status: "201", enrollment } as const;
  } catch (error: any) {
    if (error?.code === "P2002") {
      return { status: "409", error: "ALREADY_ENROLLED" } as const;
    }
    throw error;
  }
}

/**
 * PATCH /api/courses/:id/enrollments/:enrollmentId — change an enrollment's
 * role (e.g. STUDENT → TA). Enforces the instructor-floor invariant when
 * demoting an active INSTRUCTOR.
 */
export async function updateEnrollmentRole(
  courseId: string,
  enrollmentId: string,
  payload: { role?: unknown },
) {
  if (!isEnrollmentRole(payload.role)) {
    return { status: "400" } as const;
  }

  const role = payload.role;
  return prisma.$transaction(async (tx) => {
    const existing = await tx.enrollment.findFirst({
      where: { id: enrollmentId, courseId },
    });
    if (!existing) {
      return { status: "404" } as const;
    }

    if (role !== "INSTRUCTOR") {
      const violation = await instructorFloorViolation(tx, existing);
      if (violation) return violation;
    }

    const enrollment = await tx.enrollment.update({
      where: { id: enrollmentId },
      data: { role },
    });
    return { status: "200", enrollment, previousRole: existing.role } as const;
  });
}

/**
 * DELETE /api/courses/:id/enrollments/:enrollmentId — soft removal via
 * `isActive = false`. Enforces the instructor-floor invariant when
 * deactivating an active INSTRUCTOR.
 * The reconciliation cron job must catch these deleted courses and delete corresponding rows.
 */
export async function deactivateEnrollment(courseId: string, enrollmentId: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.enrollment.findFirst({
      where: { id: enrollmentId, courseId },
    });
    if (!existing) {
      return { status: "404" } as const;
    }

    const violation = await instructorFloorViolation(tx, existing);
    if (violation) return violation;

    await tx.enrollment.update({
      where: { id: enrollmentId },
      data: { isActive: false },
    });
    return { status: "204", role: existing.role } as const;
  });
}

/** Fetch a single enrollment row scoped to the course (for route-level gating). */
export async function getEnrollment(courseId: string, enrollmentId: string) {
  return prisma.enrollment.findFirst({ where: { id: enrollmentId, courseId } });
}
