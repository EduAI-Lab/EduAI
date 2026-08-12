import { Prisma } from "@prisma/client";
import type { EnrollmentRole } from "@prisma/client";
import prisma from "~/lib/prisma.server";
import { splitPage, type CursorParams } from "~/lib/cursor-list.server";

const ENROLLMENT_ROLES = ["STUDENT", "TA", "INSTRUCTOR"] as const;

export function isEnrollmentRole(value: unknown): value is EnrollmentRole {
  return typeof value === "string" && (ENROLLMENT_ROLES as readonly string[]).includes(value);
}

/**
 * Exactly the columns `mapEnrollment` (app/routes/api/courses.enrollments.ts) reads —
 * nothing more. #1369: this used to be an `include`, which pulled every enrollment column
 * (`courseId`, `updatedAt`, `externalId`, `externalSource` all went unread). Narrowing it
 * matters most for {@link getCourseEnrollments}, which is unbounded by design.
 *
 * The serialized response shape is unchanged: the mapper is the only consumer, so no field
 * that reached a client was dropped. Keep this in sync with `mapEnrollment` if it grows.
 */
const ENROLLMENT_SELECT = {
  id: true,
  userId: true,
  role: true,
  enrolledAt: true,
  isActive: true,
  user: {
    select: {
      email: true,
      name: true,
      studentId: true,
    },
  },
} satisfies Prisma.EnrollmentSelect;

/**
 * Returns all enrollments (active and inactive) for a course,
 * joined with user data to provide studentEmail and studentName.
 *
 * Does NOT filter by isActive — AI Tutor's enrollmentSync.js
 * handles that filtering on its side. Ordered by enrolledAt ascending.
 *
 * Unbounded by design: this is the full-sync contract AI Tutor's
 * enrollmentSync.js depends on (dual-auth service-key path in the route). Do
 * NOT add a limit here — bound the browser-facing roster instead via
 * {@link getCourseEnrollmentsPage} (#1042).
 */
export async function getCourseEnrollments(courseId: string) {
  return prisma.enrollment.findMany({
    where: { courseId },
    select: ENROLLMENT_SELECT,
    orderBy: { enrolledAt: "asc" },
  });
}

/**
 * Cursor-paginated student roster for the browser-facing course detail page
 * (#1042). Filters to active STUDENT rows — the same set the Students tab
 * renders — so `total` and each page agree with the UI (instructors/TAs/soft-
 * removed rows are excluded). Staff live on the Staff tab via separate
 * endpoints. Bounded to `limit` (+ `total` so the UI can show an accurate
 * student count without loading every page).
 */
export async function getCourseEnrollmentsPage(courseId: string, { cursor, limit }: CursorParams) {
  const where = { courseId, role: "STUDENT" as const, isActive: true };
  const [rows, total] = await prisma.$transaction([
    prisma.enrollment.findMany({
      where,
      select: ENROLLMENT_SELECT,
      orderBy: [{ enrolledAt: "asc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }),
    prisma.enrollment.count({ where }),
  ]);
  const { page, nextCursor } = splitPage(rows, limit);
  return { page, nextCursor, total };
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

export type AddEnrollmentPayload = {
  userId?: unknown;
  role?: unknown;
};

/**
 * §6 — manage enrollments requires rank >= 2; adding an INSTRUCTOR requires
 * rank >= 3 (ADMIN / UNIT_ADMIN). Single source of truth for REST + service.
 */
export function requiredRankForEnrollmentRole(role: unknown): number {
  return role === "INSTRUCTOR" ? 3 : 2;
}

export function canAddEnrollmentRole(actorRank: number, role: unknown): boolean {
  return actorRank >= requiredRankForEnrollmentRole(role);
}

/**
 * POST /api/courses/:id/enrollments — add a user to a course with a role.
 * Idempotency is handled by the route wrapper (#828).
 * `actorRank` is the authority for who may add which roles (§6).
 */
export async function addEnrollment(
  courseId: string,
  payload: AddEnrollmentPayload,
  actorRank: number,
) {
  if (typeof payload.userId !== "string" || !payload.userId || !isEnrollmentRole(payload.role)) {
    return { status: "422", error: "VALIDATION_ERROR", fields: { body: "userId and role required" } } as const;
  }

  if (!canAddEnrollmentRole(actorRank, payload.role)) {
    return { status: "403", error: "Forbidden" } as const;
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
      data: {
        courseId,
        userId: payload.userId,
        role: payload.role,
        isActive: true,
      },
    });
    return { status: "201", enrollment } as const;
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      // A row already exists for [courseId, userId]. If it's an inactive
      // (previously removed) enrollment, reactivate it with the requested role
      // rather than 409 — a removed TA/student must be re-addable, e.g. after a
      // TA is removed and then re-enrolled (#685 review).
      const existing = await prisma.enrollment.findUnique({
        where: { courseId_userId: { courseId, userId: payload.userId } },
      });
      if (existing && !existing.isActive) {
        const enrollment = await prisma.enrollment.update({
          where: { id: existing.id },
          data: { role: payload.role, isActive: true },
        });
        return { status: "201", enrollment } as const;
      }
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
    return { status: "422", error: "VALIDATION_ERROR", fields: { role: "invalid role" } } as const;
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
