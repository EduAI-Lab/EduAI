import type { Prisma, UserRole } from "@prisma/client";
import prisma from "~/lib/prisma.server";
import { AddTASchema, RemoveTASchema, type AddTAInput, type RemoveTAInput } from "./schemas";

// A TA is a course-level role, modelled as an Enrollment with role = "TA".
// There is no longer a separate CourseTA table or platform-level UserRole.TA.

function shapeTA(enrollment: {
  id: string;
  user: { id: string; name: string; email: string };
}) {
  return { id: enrollment.id, user: enrollment.user };
}

type ExistingCourseEnrollment = {
  id: string;
  courseId: string;
  role: "STUDENT" | "TA" | "INSTRUCTOR";
  isActive: boolean;
};

function isInstructorEnrollment(
  enrollment: Pick<ExistingCourseEnrollment, "role"> | null | undefined,
) {
  return enrollment?.role === "INSTRUCTOR";
}

/**
 * Reconcile a user's active TA enrollments to an exact desired course set.
 *
 * The caller supplies a transaction client so a platform-role update and its
 * enrollment changes commit or roll back together. All validation completes
 * before the first write, including course existence and INSTRUCTOR conflicts.
 * TA assignments removed from a STUDENT user's desired set are demoted back to
 * STUDENT enrollments, matching the one-role-per-course RBAC contract.
 */
export async function reconcileUserTACourses(
  tx: Prisma.TransactionClient,
  userId: string,
  effectiveRole: UserRole,
  requestedCourseIds: string[],
) {
  const taCourseIds = [...new Set(requestedCourseIds)];

  if (effectiveRole !== "STUDENT") {
    if (taCourseIds.length > 0) {
      return { error: "TA_ROLE_MISMATCH" } as const;
    }

    await tx.enrollment.updateMany({
      where: { userId, role: "TA", isActive: true },
      data: { isActive: false },
    });
    return { ok: true, activeTACourseIds: [] as string[] } as const;
  }

  if (taCourseIds.length === 0) {
    await tx.enrollment.updateMany({
      where: { userId, role: "TA", isActive: true },
      data: { role: "STUDENT", isActive: true },
    });
    return { ok: true, activeTACourseIds: [] as string[] } as const;
  }

  const courses = await tx.course.findMany({
    where: { id: { in: taCourseIds }, deletedAt: null },
    select: { id: true },
  });
  if (courses.length !== taCourseIds.length) {
    return { error: "TA_COURSE_NOT_FOUND" } as const;
  }

  const existingEnrollments = await tx.enrollment.findMany({
    where: { userId, courseId: { in: taCourseIds } },
    select: { id: true, courseId: true, role: true, isActive: true },
  });

  if (existingEnrollments.some(isInstructorEnrollment)) {
    return { error: "TA_INSTRUCTOR_ENROLLMENT_CONFLICT" } as const;
  }

  const enrollmentByCourseId = new Map(
    existingEnrollments.map((enrollment) => [enrollment.courseId, enrollment]),
  );

  for (const courseId of taCourseIds) {
    const existing = enrollmentByCourseId.get(courseId);
    if (!existing) {
      await tx.enrollment.create({
        data: { courseId, userId, role: "TA", isActive: true },
      });
    } else if (existing.role !== "TA" || !existing.isActive) {
      await tx.enrollment.update({
        where: { id: existing.id },
        data: { role: "TA", isActive: true },
      });
    }
  }

  await tx.enrollment.updateMany({
    where: {
      userId,
      role: "TA",
      isActive: true,
      courseId: { notIn: taCourseIds },
    },
    data: { role: "STUDENT", isActive: true },
  });

  return { ok: true, activeTACourseIds: taCourseIds } as const;
}

export async function getCourseTA(courseId: string) {
  const enrollments = await prisma.enrollment.findMany({
    where: { courseId, role: "TA", isActive: true },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { enrolledAt: "asc" },
  });
  return enrollments.map(shapeTA);
}

export async function addCourseTA(courseId: string, payload: AddTAInput) {
  const parsed = AddTASchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "Invalid input", details: parsed.error.flatten() } as const;
  }

  const user = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true, role: true },
  });

  if (!user) return { error: "User not found" } as const;

  // A TA is a STUDENT platform user with an EnrollmentRole.TA enrollment.
  // Promoting an INSTRUCTOR/ADMIN/UNIT_ADMIN to a course TA is not a valid op.
  if (user.role !== "STUDENT") {
    return { error: "Only STUDENT users can be added as a course TA" } as const;
  }

  const existing = await prisma.enrollment.findUnique({
    where: { courseId_userId: { courseId, userId: parsed.data.userId } },
    select: { role: true, isActive: true },
  });
  if (existing?.role === "TA" && existing.isActive) {
    return { error: "User is already a TA for this course" } as const;
  }
  // Never silently overwrite an existing INSTRUCTOR enrollment with a TA role —
  // the upsert's `update` branch would otherwise demote a course instructor.
  // (A plain STUDENT enrollment may still be promoted to TA.)
  if (isInstructorEnrollment(existing)) {
    return {
      error: "User is an instructor for this course and cannot be made a TA",
    } as const;
  }

  const enrollment = await prisma.enrollment.upsert({
    where: { courseId_userId: { courseId, userId: parsed.data.userId } },
    create: { courseId, userId: parsed.data.userId, role: "TA", isActive: true },
    update: { role: "TA", isActive: true },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  return { ta: shapeTA(enrollment) } as const;
}

export async function removeCourseTA(courseId: string, payload: RemoveTAInput) {
  const parsed = RemoveTASchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "Invalid input", details: parsed.error.flatten() } as const;
  }

  // A TA is an Enrollment with role = "TA"; there is no CourseTA table.
  // Capture the enrollment before deactivation so the audit log can record the
  // enrollment id and the TA's name (both unavailable once the row is inactive).
  const existing = await prisma.enrollment.findFirst({
    where: { courseId, userId: parsed.data.userId, role: "TA", isActive: true },
    select: { id: true, user: { select: { name: true } } },
  });
  if (!existing) return { error: "TA not found for this course" } as const;

  await prisma.enrollment.updateMany({
    where: { courseId, userId: parsed.data.userId, role: "TA", isActive: true },
    data: { isActive: false },
  });

  return {
    success: true,
    taId: existing.id,
    taName: existing.user?.name ?? null,
  } as const;
}
