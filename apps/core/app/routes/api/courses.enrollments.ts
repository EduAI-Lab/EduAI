/**
 * /api/courses/:id/enrollments
 *
 * GET — returns all enrollments (active and inactive) for a course.
 * Supports dual auth: user OAuth Bearer and service key (EDUAI_API_KEY).
 *
 * Primary GET caller: AI Tutor's enrollmentSync.js (via eduaiClient.js).
 * AI Tutor filters isActive: true on its side — we return everything.
 *
 * Auth rules (§6):
 *   - Service key: unrestricted access, no enrollment check.
 *   - User OAuth: ADMIN / UNIT_ADMIN(D) / INSTRUCTOR(C) / TA(C) see all;
 *     STUDENT gets 403 (students cannot see fellow enrolled peers).
 *
 * POST — add a user to the course (#305). ADMIN / UNIT_ADMIN(D) may add any
 * role including INSTRUCTOR; INSTRUCTOR(C) may add STUDENT or TA only.
 *
 * See docs/implementations/api-wiring.md for the GET contract.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { auth } from "~/lib/auth/server";
import { requireServiceKey } from "~/lib/auth/guards.server";
import { resolveCourseAccessWithCourse } from "~/lib/auth/course-access.server";
import { getPolicy, logPolicyDenial } from "~/lib/policy.server";
import { getCourse } from "~/lib/courses/server";
import { addEnrollment, getCourseEnrollments } from "~/lib/courses/enrollments.server";
import { readStoredStudentId } from "~/lib/canvas/student-id.server";
import { fireAndForget, logAuditAction } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const courseId = params.id;
  if (!courseId) {
    return new Response(JSON.stringify({ error: "COURSE_ID_REQUIRED" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // --- Dual auth: service key path vs. user OAuth session path ---
  if (request.headers.get("Authorization")?.startsWith("Bearer ")) {
    // Service key path: unrestricted, never goes through user RBAC.
    const serviceKeyGuard = await requireServiceKey(request);
    if (serviceKeyGuard) {
      return serviceKeyGuard;
    }

    // Verify the course exists (getCourse excludes soft-deleted courses)
    const course = await getCourse(courseId);
    if (!course) {
      return new Response(JSON.stringify({ error: "COURSE_NOT_FOUND" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    return enrollmentsResponse(courseId);
  }

  // User OAuth path: resolve session from cookies/headers.
  const session = await auth.api.getSession(request);

  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // §6: enrolled-user list is TA-and-up; students cannot see fellow peers.
  const { course, access } = await resolveCourseAccessWithCourse(session.user, courseId);

  if (!course) {
    return new Response(JSON.stringify({ error: "COURSE_NOT_FOUND" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!access || access.rank < 1) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  return enrollmentsResponse(courseId);
}

async function enrollmentsResponse(courseId: string) {
  const enrollments = await getCourseEnrollments(courseId);

  // Map Prisma model to the API contract shape (see api-wiring.md)
  const mapped = enrollments.map((e) => ({
    id: e.id,
    studentId: e.userId,
    studentEmail: e.user.email,
    studentName: e.user.name,
    studentNumber: readStoredStudentId(e.user.studentId),
    enrolledAt: e.enrolledAt?.toISOString() ?? null,
    isActive: e.isActive,
    role: e.role,
  }));

  return new Response(JSON.stringify({ enrollments: mapped }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const courseId = params.id;
  if (!courseId) {
    return new Response(JSON.stringify({ error: "COURSE_ID_REQUIRED" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const session = await auth.api.getSession(request);
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { course, access } = await resolveCourseAccessWithCourse(session.user, courseId);

  if (!course) {
    return new Response(JSON.stringify({ error: "COURSE_NOT_FOUND" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await request.json().catch(() => ({}));

  // Manage tier is rank >= 2; only ADMIN / UNIT_ADMIN (rank >= 3) may grow
  // the instructor set (§6 — instructors cannot add fellow instructors).
  const requiredRank = body?.role === "INSTRUCTOR" ? 3 : 2;
  if (!access || access.rank < requiredRank) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Policy gate: an INSTRUCTOR may add/remove students & TAs only when the flag
  // is on; ADMIN / UNIT_ADMIN are unaffected.
  if (access.level === "instructor" && !(await getPolicy("instructors.canManageEnrollments"))) {
    logPolicyDenial({
      policyKey: "instructors.canManageEnrollments",
      userId: session.user.id,
      role: session.user.role,
      action: "enrollment.add",
      courseId,
    });
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const requestContext = getRequestContext(request);
  const result = await addEnrollment(courseId, body ?? {});

  switch (result.status) {
    case "201":
      fireAndForget(
        logAuditAction({
          ...getActorContext(session?.user ?? null),
          ...requestContext,
          actionCode: "ENROLLMENT_ADDED",
          category: "ENROLLMENT",
          entityType: "Enrollment",
          entityId: result.enrollment.id,
          details: { courseId, role: result.enrollment.role, targetUserId: result.enrollment.userId },
        }),
      );
      return new Response(JSON.stringify(result.enrollment), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    case "409":
      return new Response(JSON.stringify({ error: result.error }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    case "422":
      return new Response(JSON.stringify({ error: result.error }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      });
    default:
      return new Response(JSON.stringify({ error: "Invalid input" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
  }
}
