/**
 * GET /api/courses/:courseId/student-candidates — search-select backend for the
 * "add student" / "add TA" pickers (#1042).
 *
 * Replaces the loader-time `prisma.user.findMany({ role: 'STUDENT' })` that used
 * to preload every platform STUDENT user into `courses.$courseId.tsx`'s
 * TA-candidate dropdown regardless of course size. Results are bounded to
 * `limit` and scoped to a `?q=` search term instead.
 *
 * Gated the same as the loader used to gate the preload: rank >= 2
 * (admin/unit/instructor) — the same floor as `canManageStudentEnrollments`.
 */
import type { LoaderFunctionArgs } from "react-router";

import { auth } from "~/lib/auth/server";
import { resolveCourseAccessWithCourse } from "~/lib/auth/course-access.server";
import { jsonResponse as json } from "~/lib/api/json-response.server";
import prisma from "~/lib/prisma.server";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 25;

export async function loader({ request, params }: LoaderFunctionArgs) {
  const courseId = params.courseId;
  if (!courseId) {
    return json({ error: "Course ID is required" }, 400);
  }

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const { course, access } = await resolveCourseAccessWithCourse(session.user, courseId);
  if (!course) {
    return json({ error: "COURSE_NOT_FOUND" }, 404);
  }
  if (!access || access.rank < 2) {
    return json({ error: "Forbidden" }, 403);
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() || null;
  const rawLimit = Number(url.searchParams.get("limit"));
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(MAX_LIMIT, Math.floor(rawLimit)) : DEFAULT_LIMIT;
  // "ta" excludes users already an active TA in this course; the default
  // ("enrolled") excludes anyone with any active enrollment — used by the
  // "add student" picker so an existing TA/instructor can't be re-added as a
  // student. Anti-join via `enrollments: { none }` keeps the exclusion
  // bounded — no unbounded `NOT IN` list of every enrollment userId.
  const exclude = url.searchParams.get("exclude") === "ta" ? "ta" : "enrolled";
  const enrollmentNone =
    exclude === "ta"
      ? { courseId, role: "TA" as const, isActive: true }
      : { courseId, isActive: true };

  const candidates = await prisma.user.findMany({
    where: {
      role: "STUDENT",
      isActive: true,
      enrollments: { none: enrollmentNone },
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
    take: limit,
  });

  return json({ candidates });
}
