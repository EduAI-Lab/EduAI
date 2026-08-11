/**
 * /api/courses/:id/enrollments/:enrollmentId (#305, §6)
 *
 * PATCH  — change an enrollment's role (e.g. STUDENT → TA).
 *          ADMIN / UNIT_ADMIN(D) / INSTRUCTOR(C); promotions to INSTRUCTOR
 *          are ADMIN / UNIT_ADMIN(D) only.
 * DELETE — soft removal (isActive = false).
 *          ADMIN / UNIT_ADMIN(D) / INSTRUCTOR(C) for STUDENT/TA removals;
 *          INSTRUCTOR-enrollment removals are ADMIN / UNIT_ADMIN(D) only.
 *
 * Both verbs enforce the instructor-floor invariant (§6): an operation that
 * would leave the course with zero active INSTRUCTOR enrollments is rejected
 * with 409 INSTRUCTOR_FLOOR_VIOLATION — including for ADMIN, no override.
 */
import type { ActionFunctionArgs } from "react-router";

import { resolveCourseAccessGate } from "~/lib/auth/course-access.server";
import {
  deactivateEnrollment,
  getEnrollment,
  updateEnrollmentRole,
} from "~/lib/courses/enrollments.server";
import { fireAndForget, logAuditAction } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";
import { getRequestSession } from "~/lib/auth/request-session.server";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "PATCH" && request.method !== "DELETE") {
    return json(405, { error: "Method not allowed" });
  }

  const courseId = params.id;
  const enrollmentId = params.enrollmentId;
  if (!courseId || !enrollmentId) {
    return json(400, { error: "COURSE_ID_AND_ENROLLMENT_ID_REQUIRED" });
  }

  const session = await getRequestSession(request);
  if (!session?.user) {
    return json(401, { error: "Unauthorized" });
  }

  const { course, access } = await resolveCourseAccessGate(session.user, courseId);

  if (!course) {
    return json(404, { error: "COURSE_NOT_FOUND" });
  }

  // Manage tier: ADMIN / UNIT_ADMIN(D) / INSTRUCTOR(C).
  if (!access || access.rank < 2) {
    return json(403, { error: "Forbidden" });
  }

  const target = await getEnrollment(courseId, enrollmentId);
  if (!target) {
    return json(404, { error: "ENROLLMENT_NOT_FOUND" });
  }

  const requestContext = getRequestContext(request);

  if (request.method === "PATCH") {
    const body = await request.json().catch(() => ({}));

    // §6: only ADMIN / UNIT_ADMIN may promote to INSTRUCTOR or change an
    // existing INSTRUCTOR enrollment — instructors cannot manage peers.
    const touchesInstructor = body?.role === "INSTRUCTOR" || target.role === "INSTRUCTOR";
    if (touchesInstructor && access.rank < 3) {
      return json(403, { error: "Forbidden" });
    }

    const result = await updateEnrollmentRole(courseId, enrollmentId, body ?? {});

    switch (result.status) {
      case "200":
        fireAndForget(
          logAuditAction({
            ...getActorContext(session?.user ?? null),
            ...requestContext,
            actionCode: "ENROLLMENT_ROLE_CHANGED",
            category: "ENROLLMENT",
            entityType: "Enrollment",
            entityId: enrollmentId,
            details: {
              courseId,
              previousRole: result.previousRole,
              newRole: result.enrollment.role,
            },
          }),
        );
        return json(200, result.enrollment);
      case "409":
        return json(409, {
          error: result.error,
          currentInstructorCount: result.currentInstructorCount,
        });
      case "404":
        return json(404, { error: "ENROLLMENT_NOT_FOUND" });
      default:
        return json(400, { error: "Invalid input" });
    }
  }

  // DELETE — §6: an INSTRUCTOR cannot remove a fellow instructor.
  if (target.role === "INSTRUCTOR" && access.rank < 3) {
    return json(403, { error: "Forbidden" });
  }

  const result = await deactivateEnrollment(courseId, enrollmentId);

  switch (result.status) {
    case "204":
      fireAndForget(
        logAuditAction({
          ...getActorContext(session?.user ?? null),
          ...requestContext,
          actionCode: "ENROLLMENT_DEACTIVATED",
          category: "ENROLLMENT",
          entityType: "Enrollment",
          entityId: enrollmentId,
          details: { courseId },
        }),
      );
      return new Response(null, { status: 204 });
    case "409":
      return json(409, {
        error: result.error,
        currentInstructorCount: result.currentInstructorCount,
      });
    default:
      return json(404, { error: "ENROLLMENT_NOT_FOUND" });
  }
}
