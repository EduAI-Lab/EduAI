import type { JsonValue } from "~/lib/json-value";
import { Prisma } from "@prisma/client";
import type { Enrollment, EnrollmentRole } from "@prisma/client";
import prisma from "~/lib/prisma.server";
import { splitPage, type CursorParams } from "~/lib/cursor-list.server";
import { z } from "zod";
import { asPresentText } from "~/lib/json-value";

const ENROLLMENT_ROLES = ["STUDENT", "TA", "INSTRUCTOR"] as const;

export function isEnrollmentRole(value: JsonValue | undefined): value is EnrollmentRole {
  return z.enum(ENROLLMENT_ROLES).safeParse(value).success;
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

/** Service-key authorization lookup that avoids loading or reconciling a full roster. */
export async function getCourseEnrollmentForUser(courseId: string, userId: string) {
  return prisma.enrollment.findUnique({
    where: { courseId_userId: { courseId, userId } },
    select: ENROLLMENT_SELECT,
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
  const pageArgs = {
    where,
    select: ENROLLMENT_SELECT,
    orderBy: [{ enrolledAt: "asc" as const }, { id: "asc" as const }],
    take: limit + 1,
  };
  const [rows, total] = await prisma.$transaction([
    // A cursor page resumes past the cursor row itself; the first page sends
    // neither key, so Prisma never sees a half-specified pair.
    cursor
      ? prisma.enrollment.findMany({ ...pageArgs, cursor: { id: cursor }, skip: 1 })
      : prisma.enrollment.findMany(pageArgs),
    prisma.enrollment.count({ where }),
  ]);
  const { page, nextCursor } = splitPage(rows, limit);
  return { page, nextCursor, total };
}

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Serialize enrollment mutations that can affect the instructor floor. A row
 * lock on the parent course makes the subsequent count-and-write decision
 * observe any earlier concurrent mutation before it proceeds.
 */
async function lockCourseEnrollmentMutations(tx: TxClient, courseId: string) {
  await tx.$queryRaw`
    SELECT "id"
    FROM "courses"
    WHERE "id" = ${courseId}
    FOR UPDATE
  `;
}

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
 * Hand `Course.instructorId` to the longest-standing remaining active
 * instructor when `userId` stops being one. Removal is not the only way that
 * happens: demoting the head to TA through {@link updateEnrollmentRole} passes
 * the floor check whenever another instructor exists, and left the column
 * naming someone who is now a TA (#1840 review). Both mutations call this
 * *after* their own write lands, so the row is no longer an active INSTRUCTOR
 * and cannot be selected as its own successor.
 *
 * A no-op unless `userId` is the current head. The instructor floor guarantees
 * a successor on both call paths; `?? null` is the honest fallback rather than
 * leaving the column pointing at a non-instructor.
 */
async function reassignPrimaryIfNeeded(tx: TxClient, courseId: string, userId: string) {
  const course = await tx.course.findUnique({
    where: { id: courseId },
    select: { instructorId: true },
  });
  // Three separate reasons to do nothing, kept apart so a missing course or an
  // already-null column can never fall through to the write below.
  if (!course || course.instructorId === null) return;
  if (course.instructorId !== userId) return;

  const successor = await tx.enrollment.findFirst({
    where: { courseId, role: "INSTRUCTOR", isActive: true },
    orderBy: [{ enrolledAt: "asc" }, { id: "asc" }],
    select: { userId: true },
  });
  await tx.course.update({
    where: { id: courseId },
    data: { instructorId: successor?.userId ?? null },
  });
}

/**
 * Claim a vacant `Course.instructorId` for an incoming instructor.
 *
 * A course can legitimately have no head — `instructorUserIds: []` is allowed
 * at creation — and the old "Assign" control (a PATCH of `instructorId`) was
 * the only thing that ever filled it. #1840 replaced that control with "Add
 * instructors", a plain enrollments POST, so without this an admin could add
 * Dr. A, see them active on the Staff tab, and still read
 * `course.instructor === null` on the course page, on `GET /api/courses/:id`,
 * and in every extension reading the single column — with no Primary badge
 * until someone thought to click "Make primary" (#1840 review).
 *
 * Lives in the enrollment write's own transaction so CSV import and the REST
 * API get it too, rather than only the picker.
 */
async function claimPrimaryIfVacant(tx: TxClient, courseId: string, userId: string) {
  const course = await tx.course.findUnique({
    where: { id: courseId },
    select: { instructorId: true },
  });
  if (!course || course.instructorId !== null) return;
  await tx.course.update({ where: { id: courseId }, data: { instructorId: userId } });
}

/** The request body of "add someone to this course", straight off the wire. */
export type AddEnrollmentPayload = {
  userId?: JsonValue;
  role?: JsonValue;
};

/**
 * §6 — manage enrollments requires rank >= 2; adding an INSTRUCTOR requires
 * rank >= 3 (ADMIN / UNIT_ADMIN). Single source of truth for REST + service.
 */
export function requiredRankForEnrollmentRole(role: JsonValue | undefined): number {
  return role === "INSTRUCTOR" ? 3 : 2;
}

export function canAddEnrollmentRole(actorRank: number, role: JsonValue | undefined): boolean {
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
  const userId = asPresentText(payload.userId);
  if (userId === null || !isEnrollmentRole(payload.role)) {
    return {
      status: "422",
      error: "VALIDATION_ERROR",
      fields: { body: "userId and role required" },
    } as const;
  }

  if (!canAddEnrollmentRole(actorRank, payload.role)) {
    return { status: "403", error: "Forbidden" } as const;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) {
    return { status: "422", error: "USER_NOT_FOUND" } as const;
  }

  const role = payload.role;
  /**
   * Adding an INSTRUCTOR is the only role that can fill a vacant course head,
   * so only it pays for a transaction and the course row lock (the lock also
   * keeps two concurrent adds from both reading a null `instructorId`). Every
   * other role keeps the plain single-statement write — bulk STUDENT import
   * runs one call per row and has no reason to hold a course-wide lock.
   */
  const commit = async (write: (client: TxClient) => Promise<Enrollment>) =>
    role === "INSTRUCTOR"
      ? prisma.$transaction(async (tx) => {
          await lockCourseEnrollmentMutations(tx, courseId);
          const enrollment = await write(tx);
          await claimPrimaryIfVacant(tx, courseId, userId);
          return enrollment;
        })
      : write(prisma);

  try {
    const enrollment = await commit((client) =>
      client.enrollment.create({
        data: {
          courseId,
          userId,
          role,
          isActive: true,
        },
      }),
    );
    return { status: "201", enrollment } as const;
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // A row already exists for [courseId, userId]. If it's an inactive
      // (previously removed) enrollment, reactivate it with the requested role
      // rather than 409 — a removed TA/student must be re-addable, e.g. after a
      // TA is removed and then re-enrolled (#685 review).
      const existing = await prisma.enrollment.findUnique({
        where: { courseId_userId: { courseId, userId } },
      });
      if (existing && !existing.isActive) {
        const enrollment = await commit((client) =>
          client.enrollment.update({
            where: { id: existing.id },
            data: { role, isActive: true },
          }),
        );
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
  payload: { role?: JsonValue },
) {
  if (!isEnrollmentRole(payload.role)) {
    return { status: "422", error: "VALIDATION_ERROR", fields: { role: "invalid role" } } as const;
  }

  const role = payload.role;
  return prisma.$transaction(async (tx) => {
    await lockCourseEnrollmentMutations(tx, courseId);
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

    // Demotion is the other way to stop being an instructor: the floor check
    // above passes whenever a second instructor exists, so without this the
    // course head could be left showing as someone who is now a TA (#1840
    // review). Runs after the role change so the demoted row is no longer an
    // active INSTRUCTOR and cannot be picked as its own successor.
    if (role !== "INSTRUCTOR" && existing.role === "INSTRUCTOR" && existing.isActive) {
      await reassignPrimaryIfNeeded(tx, courseId, existing.userId);
    }

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
    await lockCourseEnrollmentMutations(tx, courseId);
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

    // #1840: `Course.instructorId` names the course head. Removing that person
    // would leave the column pointing at someone who no longer teaches the
    // course, which every surface reading `course.instructor` would still
    // render. Hand it to the longest-standing remaining instructor instead —
    // the floor check above guarantees at least one exists, so this never
    // nulls the column. Shared with the demotion path in
    // {@link updateEnrollmentRole}.
    if (existing.role === "INSTRUCTOR" && existing.isActive) {
      await reassignPrimaryIfNeeded(tx, courseId, existing.userId);
    }

    return { status: "204", role: existing.role } as const;
  });
}

/** Fetch a single enrollment row scoped to the course (for route-level gating). */
export async function getEnrollment(courseId: string, enrollmentId: string) {
  return prisma.enrollment.findFirst({ where: { id: enrollmentId, courseId } });
}
