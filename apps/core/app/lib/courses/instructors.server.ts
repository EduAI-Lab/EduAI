import prisma from "~/lib/prisma.server";

/**
 * One instructor of record, as every course surface renders them (#1841).
 *
 * `email` is nullable because students must not receive staff contact details —
 * the same PII boundary `courses.tas.$.ts` applies to the TA roster. Redact at
 * the audience boundary with {@link redactInstructorEmails}, not here, so staff
 * callers still get the address they rely on.
 */
export type CourseInstructorSummary = {
  id: string;
  name: string;
  email: string | null;
  /** True for the row `Course.instructorId` points at — the course head. */
  isPrimary: boolean;
};

/**
 * Every ACTIVE instructor for each requested course, keyed by course id.
 *
 * #1841: `Course.instructorId` is single-valued and is what the UI used to
 * render, so a course with three instructors displayed one. Access is already
 * resolved from enrollments (`resolveCourseAccess` explicitly `void`s
 * `instructorId`), so reading them here makes the display agree with the
 * authorization.
 *
 * One query for the whole batch, so a course list costs a single extra
 * round trip rather than one per course. Courses with no active instructor are
 * absent from the map rather than mapped to an empty array — callers default
 * with `?? []`, and the distinction is not meaningful to any of them.
 */
export async function getCourseInstructors(
  courseIds: string[],
  // A caller that already holds the course rows (the list endpoint does) passes
  // their heads here, so the batch costs one query instead of two.
  knownPrimaries?: Map<string, string | null>,
): Promise<Map<string, CourseInstructorSummary[]>> {
  const byCourse = new Map<string, CourseInstructorSummary[]>();
  if (courseIds.length === 0) return byCourse;

  const [enrollments, courses] = await Promise.all([
    prisma.enrollment.findMany({
      where: { courseId: { in: courseIds }, role: "INSTRUCTOR", isActive: true },
      select: {
        courseId: true,
        userId: true,
        user: { select: { name: true, email: true } },
      },
      // Stable, meaningful order: longest-standing instructor first. `id` breaks
      // ties so two instructors added in the same transaction do not swap
      // places between renders.
      orderBy: [{ enrolledAt: "asc" }, { id: "asc" }],
    }),
    knownPrimaries
      ? []
      : prisma.course.findMany({
          where: { id: { in: courseIds } },
          select: { id: true, instructorId: true },
        }),
  ]);

  const primaryByCourse =
    knownPrimaries ?? new Map(courses.map((course) => [course.id, course.instructorId]));

  for (const enrollment of enrollments) {
    const list = byCourse.get(enrollment.courseId) ?? [];
    list.push({
      id: enrollment.userId,
      name: enrollment.user.name,
      email: enrollment.user.email,
      isPrimary: primaryByCourse.get(enrollment.courseId) === enrollment.userId,
    });
    byCourse.set(enrollment.courseId, list);
  }

  return byCourse;
}

/**
 * Student-audience copy with contact details removed (#1841).
 *
 * Students may see who teaches their course — that is the point of the list —
 * but not how to reach them, matching the roster endpoint's existing boundary.
 */
export function redactInstructorEmails(
  instructors: CourseInstructorSummary[],
): CourseInstructorSummary[] {
  return instructors.map((instructor) => ({ ...instructor, email: null }));
}
