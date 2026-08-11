import type { Course, Prisma } from "@prisma/client";
import prisma from "../prisma.server";

/**
 * Resolved course access level per the shared RBAC contract
 * (docs/implementations/rbac-matrix.md §3). AI Tutor and Question Maker
 * implement the same shape in their own stacks.
 */
export type AccessLevel = {
  level: "admin" | "unit" | "instructor" | "ta" | "student";
  rank: 4 | 3 | 2 | 1 | 0;
};

/** Minimal user shape needed to resolve access (a better-auth session user satisfies it). */
export type RbacUser = {
  id: string;
  name?: string | null;
  role?: string | null;
  /**
   * Optional — fetched from the DB when absent and the user is a UNIT_ADMIN.
   * Accepts `null` so a better-auth session user (whose array additional-field
   * is typed `string[] | null`) is assignable without a cast.
   */
  authorizedUnits?: string[] | null;
};

const LEVELS: Record<AccessLevel["level"], AccessLevel> = {
  admin: { level: "admin", rank: 4 },
  unit: { level: "unit", rank: 3 },
  instructor: { level: "instructor", rank: 2 },
  ta: { level: "ta", rank: 1 },
  student: { level: "student", rank: 0 },
};

/** Look up the shared AccessLevel for a resolved course access level string. */
export function accessLevelFor(level: AccessLevel["level"]): AccessLevel {
  return LEVELS[level];
}

/**
 * RAG settings route gate (`GET`/`PATCH /api/courses/:id/rag-settings`):
 * instructor-or-above only — `access.rank >= 2` (admin / unit / instructor).
 * Shared so the route and drift-contract tests cannot diverge.
 */
export function canManageCourseRagSettings(access: AccessLevel | null): boolean {
  return access != null && access.rank >= 2;
}

/**
 * Session users don't carry `authorizedUnits` (not a better-auth additional
 * field) — fetch lazily, only for UNIT_ADMIN callers.
 */
export async function getAuthorizedUnits(user: RbacUser): Promise<string[]> {
  if (user.authorizedUnits) return user.authorizedUnits;
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { authorizedUnits: true },
  });
  return row?.authorizedUnits ?? [];
}

/**
 * The only columns the access decision itself reads (`department`), plus the
 * fields gate-only callers need to answer 404 / 403 / publish questions.
 * Deliberately narrow: the Course row is ~30 columns wide (RAG + model config,
 * Canvas sync state, long text) and every course-scoped request pays for it.
 */
export const GATE_COURSE_SELECT = {
  id: true,
  department: true,
  isPublished: true,
  instructorId: true,
  deletedAt: true,
} satisfies Prisma.CourseSelect;

/** Projected course row returned by `resolveCourseAccessGate`. */
export type GateCourse = Prisma.CourseGetPayload<{
  select: typeof GATE_COURSE_SELECT;
}>;

/**
 * Single home for the access decision (rbac-matrix.md §3, §19). Both public
 * resolvers below delegate here and differ ONLY in how wide a course row they
 * ask for — the RBAC logic is never duplicated.
 *
 * The enrollment lookup is keyed on `courseId`/`userId` alone, so it does not
 * depend on the course row and can start alongside it. It is only *speculated*
 * for roles whose decision always needs it:
 *   - ADMIN short-circuits before the enrollment check and never reads it.
 *   - UNIT_ADMIN reaches it only after the unit check falls through, and that
 *     check is already sequential behind `course.department` — speculating
 *     there would add a query without saving a round trip, so it stays lazy.
 * Every other role always needs the enrollment, so it runs in parallel with the
 * course fetch. Net effect: no role issues more queries than before, and the
 * common path drops one round trip.
 *
 * `getAuthorizedUnits` DOES depend on `course.department` and stays sequential
 * on the UNIT_ADMIN branch.
 */
async function resolveAccess<C extends { department: string | null }>(
  user: RbacUser,
  courseId: string,
  fetchCourse: () => Promise<C | null>,
): Promise<{ course: C | null; access: AccessLevel | null }> {
  const findEnrollment = () =>
    prisma.enrollment.findUnique({
      where: { courseId_userId: { courseId, userId: user.id } },
    });

  const speculated = user.role !== "ADMIN" && user.role !== "UNIT_ADMIN";
  const [course, preloadedEnrollment] = await Promise.all([
    fetchCourse(),
    speculated ? findEnrollment() : null,
  ]);

  if (!course) return { course: null, access: null };

  if (user.role === "ADMIN") return { course, access: LEVELS.admin };

  if (user.role === "UNIT_ADMIN") {
    // §19 unit lock: a null department is never a match for UNIT_ADMIN.
    if (course.department !== null) {
      const units = await getAuthorizedUnits(user);
      if (units.includes(course.department)) {
        return { course, access: LEVELS.unit };
      }
    }
    // UNIT_ADMIN outside their units may still hold an enrollment — fall through.
  }

  // `speculated` (not `preloadedEnrollment != null`) decides whether to reuse:
  // a speculated query that found nothing is a real "no enrollment" answer and
  // must not be re-issued.
  const enrollment = speculated ? preloadedEnrollment : await findEnrollment();
  if (!enrollment?.isActive) return { course, access: null };

  switch (enrollment.role) {
    case "INSTRUCTOR":
      return { course, access: LEVELS.instructor };
    case "TA":
      return { course, access: LEVELS.ta };
    case "STUDENT":
      return { course, access: LEVELS.student };
    default:
      return { course, access: null };
  }
}

/**
 * Core-local refinement of the shared contract: resolves access AND returns
 * a projected course row (fetched once, `deletedAt: null`) so route handlers
 * can distinguish 404 (course === null) from 403 (access === null) without a
 * second query, and apply the student publish gate themselves:
 *
 *   if (access.level === "student" && !course.isPublished) → 403
 *
 * The publish gate deliberately lives in callers — own-resource paths and
 * rank-gated write paths legitimately bypass it (§19).
 *
 * This is the default for course-scoped guards. Reach for
 * `resolveCourseAccessWithCourse` only when the caller genuinely serializes or
 * reads columns outside `GATE_COURSE_SELECT`.
 */
export async function resolveCourseAccessGate(
  user: RbacUser,
  courseId: string,
): Promise<{ course: GateCourse | null; access: AccessLevel | null }> {
  return resolveAccess(user, courseId, () =>
    prisma.course.findFirst({
      where: { id: courseId, deletedAt: null },
      select: GATE_COURSE_SELECT,
    }),
  );
}

/**
 * Same access decision as `resolveCourseAccessGate`, but returns the FULL
 * Course row. Reserved for the handful of callers that serialize the course to
 * a client or read wide columns (embedding settings, RAG/response-style config);
 * everything else should use the gate.
 */
export async function resolveCourseAccessWithCourse(
  user: RbacUser,
  courseId: string,
): Promise<{ course: Course | null; access: AccessLevel | null }> {
  return resolveAccess(user, courseId, () =>
    prisma.course.findFirst({
      where: { id: courseId, deletedAt: null },
    }),
  );
}

/**
 * Shared contract entry point (rbac-matrix.md §3):
 * `resolveCourseAccess(user, courseId) → Promise<AccessLevel | null>`.
 * Returns null when the course does not exist (or is soft-deleted) or the
 * user has no relationship to it.
 */
export async function resolveCourseAccess(
  user: RbacUser,
  courseId: string,
): Promise<AccessLevel | null> {
  const { access } = await resolveCourseAccessGate(user, courseId);
  return access;
}

/**
 * Prisma WHERE filter scoping `GET /api/courses` to what the caller may list
 * (§5). The student publish gate is applied per ENROLLMENT role, not platform
 * role — a UserRole=STUDENT grad TA sees unpublished courses where they hold
 * EnrollmentRole=TA but only published ones where they are a STUDENT (§1).
 */
export async function buildCourseListFilter(
  user: RbacUser,
  // §19 forensics opt-in (#315): ADMIN-only. Honored solely for ADMIN; every
  // other role always filters `deletedAt: null` regardless of the flag.
  includeDeleted = false,
): Promise<Prisma.CourseWhereInput> {
  if (user.role === "ADMIN") return includeDeleted ? {} : { deletedAt: null };

  if (user.role === "UNIT_ADMIN") {
    const units = await getAuthorizedUnits(user);
    return {
      deletedAt: null,
      OR: [
        { department: { in: units } },
        // Outside their units a UNIT_ADMIN still sees courses they're enrolled in.
        ...enrollmentBranches(user.id),
      ],
    };
  }

  return { deletedAt: null, OR: enrollmentBranches(user.id) };
}

function enrollmentBranches(userId: string): Prisma.CourseWhereInput[] {
  return [
    {
      enrollments: {
        some: { userId, isActive: true, role: { in: ["INSTRUCTOR", "TA"] } },
      },
    },
    {
      isPublished: true,
      enrollments: { some: { userId, isActive: true, role: "STUDENT" } },
    },
  ];
}

/**
 * §19 forensics opt-in (#315): does this request ask to surface soft-deleted
 * records, AND is the caller allowed to? ADMIN-only — returns false for every
 * other role, so it is a no-op for normal traffic. Centralizes the check that
 * was previously duplicated (with subtly different shapes) across every
 * course/question read route, giving one place to fix or extend it.
 */
export function wantsIncludeDeleted(
  request: Request,
  user: { role?: string | null } | null | undefined,
): boolean {
  return (
    user?.role === "ADMIN" &&
    new URL(request.url).searchParams.get("includeDeleted") === "true"
  );
}

/**
 * §19 answer-visibility rule: `Question.answer` is never returned to a caller
 * whose resolved access is `student`. Enforced at the serialization layer —
 * call this on every question response path, regardless of route guards.
 * Returns the input untouched for every other access level.
 */
export function stripAnswerForStudents<T extends { answer?: unknown }>(
  question: T,
  access: AccessLevel | null,
): T | Omit<T, "answer"> {
  if (access?.level !== "student") return question;
  const { answer: _answer, ...rest } = question;
  return rest;
}
