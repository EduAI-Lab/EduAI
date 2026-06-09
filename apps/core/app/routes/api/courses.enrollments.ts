/**
 * GET /api/courses/:id/enrollments
 *
 * Returns all enrollments (active and inactive) for a course.
 * Supports dual auth: user OAuth Bearer and service key (EDUAI_API_KEY).
 * This is the only Core endpoint that accepts both auth types.
 *
 * Primary caller: AI Tutor's enrollmentSync.js (via eduaiClient.js).
 * AI Tutor filters isActive: true on its side — we return everything.
 *
 * Auth rules:
 *   - Service key: unrestricted access, no enrollment check.
 *   - User OAuth: caller must be enrolled in the course, else 403.
 *
 * See docs/implementations/api-wiring.md for the full contract.
 */
import type { LoaderFunctionArgs } from "react-router";

import { auth } from "~/lib/auth/server";
import { requireServiceKey } from "~/lib/auth/guards.server";
import { getCourse } from "~/lib/courses/server";
import { getCourseEnrollments } from "~/lib/courses/enrollments.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const courseId = params.id;
  if (!courseId) {
    return new Response(JSON.stringify({ error: "COURSE_ID_REQUIRED" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // --- Dual auth: service key path vs. user OAuth session path ---
  let isServiceKey = false;
  let userId: string | null = null;

  if (request.headers.get("Authorization")?.startsWith("Bearer ")) {
    // Service key path: validate EDUAI_API_KEY via requireServiceKey.
    // Returns null on success (caller may proceed), or a 401/403 Response on failure.
    const serviceKeyGuard = await requireServiceKey(request);
    if (serviceKeyGuard) {
      return serviceKeyGuard;
    }
    isServiceKey = true;
  } else {
    // User OAuth path: resolve session from cookies/headers.
    const session = await auth.api.getSession(request);

    if (!session?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    userId = session.user.id;
  }

  // Verify the course exists (getCourse excludes soft-deleted courses)
  const course = await getCourse(courseId);
  if (!course) {
    return new Response(JSON.stringify({ error: "COURSE_NOT_FOUND" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const enrollments = await getCourseEnrollments(courseId);

  // Authorization: service key callers skip this check entirely.
  // User OAuth callers must themselves be enrolled in the course (instructors
  // are stored as enrollment rows, so this covers the "enrolled OR instructor"
  // rule). This is the #275-specced inline check, not the ADMIN-only placeholder.
  // TODO(RBAC #292): replace with resolveCourseAccess
  if (!isServiceKey && userId) {
    const callerEnrollment = enrollments.find((e) => e.userId === userId);

    if (!callerEnrollment) {
      return new Response(
        JSON.stringify({ error: "Forbidden: not enrolled in this course" }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }

  // Map Prisma model to the API contract shape (see api-wiring.md)
  const mapped = enrollments.map((e) => ({
    studentId: e.userId,
    studentEmail: e.user.email,
    studentName: e.user.name,
    enrolledAt: e.enrolledAt?.toISOString() ?? null,
    isActive: e.isActive,
    role: e.role,
  }));

  return new Response(JSON.stringify({ enrollments: mapped }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
