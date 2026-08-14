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

import { requireServiceKey } from "~/lib/auth/guards.server";
import { resolveCourseAccessGate } from "~/lib/auth/course-access.server";
import { getPolicy, denyByPolicy } from "~/lib/policy.server";
import { resolvePolicyGate } from "~/lib/rbac/permissions";
import { getCourse } from "~/lib/courses/server";
import { readStoredStudentId } from "~/lib/canvas/student-id.server";
import {
  addEnrollment,
  getCourseEnrollments,
  getCourseEnrollmentsPage,
  requiredRankForEnrollmentRole,
} from "~/lib/courses/enrollments.server";
import { fireAndForget, logAuditAction } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";
import { withIdempotency } from "~/lib/idempotency.server";
import { parseCursorParams } from "~/lib/cursor-list.server";
import { getRequestSession } from "~/lib/auth/request-session.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const url = new URL(request.url);
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

    // Service key path stays a full, unpaged read — AI Tutor's enrollmentSync.js
    // depends on getting every row back in one call (see module docblock).
    return fullEnrollmentsResponse(courseId);
  }

  // User OAuth path: resolve session from cookies/headers.
  const session = await getRequestSession(request);

  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // §6: enrolled-user list is TA-and-up; students cannot see fellow peers.
  const { course, access } = await resolveCourseAccessGate(session.user, courseId);

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

  // Browser roster view: cursor/limit "load more" (#1042) — bounded, unlike the
  // service-key path above. `cursor`/`limit` are both optional so existing
  // callers that pass neither still get a bounded first page.
  const { cursor, limit } = parseCursorParams(url.searchParams);
  return pagedEnrollmentsResponse(courseId, { cursor, limit });
}

function mapEnrollment(e: {
  id: string;
  userId: string;
  enrolledAt: Date | null;
  isActive: boolean;
  role: string;
  user: { email: string; name: string; studentId: string | null };
}) {
  return {
    id: e.id,
    studentId: e.userId,
    studentEmail: e.user.email,
    studentName: e.user.name,
    studentNumber: readStoredStudentId(e.user.studentId),
    enrolledAt: e.enrolledAt?.toISOString() ?? null,
    isActive: e.isActive,
    role: e.role,
  };
}

/** Service-key path (AI Tutor sync): unpaged, matches the historical contract. */
async function fullEnrollmentsResponse(courseId: string) {
  const enrollments = await getCourseEnrollments(courseId);
  return new Response(JSON.stringify({ enrollments: enrollments.map(mapEnrollment) }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** User-session path: cursor-paginated active STUDENT roster, with `total`. */
async function pagedEnrollmentsResponse(
  courseId: string,
  params: { cursor: string | null; limit: number },
) {
  const { page, nextCursor, total } = await getCourseEnrollmentsPage(courseId, params);
  return new Response(
    JSON.stringify({ enrollments: page.map(mapEnrollment), nextCursor, total }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
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

  const session = await getRequestSession(request);
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { course, access } = await resolveCourseAccessGate(session.user, courseId);

  if (!course) {
    return new Response(JSON.stringify({ error: "COURSE_NOT_FOUND" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Peek body before idempotency so RBAC/policy cannot be skipped on replay.
  const peekedBody = await request
    .clone()
    .json()
    .catch(() => null);
  const bodyPreview =
    peekedBody && typeof peekedBody === "object" && !Array.isArray(peekedBody)
      ? (peekedBody as Record<string, unknown>)
      : null;
  // Rank authority lives in enrollments.server; route defers to the same helper.
  const requiredRank = requiredRankForEnrollmentRole(bodyPreview?.role);
  if (!access || access.rank < requiredRank) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const enrollmentGate = resolvePolicyGate(access.level, "manageEnrollments");
  if (
    enrollmentGate !== "always" &&
    enrollmentGate !== "never" &&
    !(await getPolicy(enrollmentGate))
  ) {
    return denyByPolicy({
      request,
      policyKey: enrollmentGate,
      user: session.user,
      action: "enrollment.add",
      courseId,
    });
  }

  const requestContext = getRequestContext(request);
  const actorRank = access.rank;

  return withIdempotency(
    {
      request,
      route: `POST /api/courses/${courseId}/enrollments`,
      actorId: session.user.id,
      body: bodyPreview,
    },
    async (body) => {
      const result = await addEnrollment(courseId, body ?? {}, actorRank);

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
        case "403":
          return new Response(JSON.stringify({ error: result.error }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          });
        case "422":
          return new Response(
            JSON.stringify(
              "fields" in result
                ? { error: result.error, fields: result.fields }
                : { error: result.error },
            ),
            {
              status: 422,
              headers: { "Content-Type": "application/json" },
            },
          );
        default:
          return new Response(JSON.stringify({ error: "VALIDATION_ERROR", fields: { body: "invalid" } }), {
            status: 422,
            headers: { "Content-Type": "application/json" },
          });
      }
    },
  );
}
