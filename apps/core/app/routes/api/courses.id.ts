import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { auth } from "~/lib/auth/server";
import { requireServiceKey } from "~/lib/auth/guards.server";
import { resolveCourseAccessWithCourse } from "~/lib/auth/course-access.server";
import { getCourse, updateCourse, deleteCourse } from "~/lib/courses/server";
import { UpdateCourseSchema } from "~/lib/courses/schemas";
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

  // Service-key path (extensions): unscoped, never goes through user RBAC.
  if (request.headers.get("Authorization")?.startsWith("Bearer ")) {
    const serviceKeyGuard = await requireServiceKey(request);
    if (serviceKeyGuard) return serviceKeyGuard;

    const course = await getCourse(courseId);
    if (!course) {
      return new Response(JSON.stringify({ error: "COURSE_NOT_FOUND" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify(course), {
      status: 200,
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

  // §5: viewing course details requires a course relationship; students
  // additionally require the course to be published.
  const { course, access } = await resolveCourseAccessWithCourse(session.user, courseId);

  if (!course) {
    return new Response(JSON.stringify({ error: "COURSE_NOT_FOUND" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!access || (access.level === "student" && !course.isPublished)) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(course), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const courseId = params.id;
  if (!courseId) {
    return new Response(JSON.stringify({ error: "COURSE_ID_REQUIRED" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const requestContext = getRequestContext(request);

  const session = await auth.api.getSession(request);

  switch (request.method) {
    case "PATCH": {
      // Read the validated field names from a clone so the service still owns the body.
      const validated = await request
        .clone()
        .json()
        .then((body) => UpdateCourseSchema.safeParse(body))
        .catch(() => null);
      const requestedFields =
        validated && validated.success ? Object.keys(validated.data) : [];

      const response = await updateCourse(request, courseId);

      if (response.status === 200) {
        const updated = await response
          .clone()
          .json()
          .catch(() => null);
        // updateCourse strips instructorId/department for callers below rank 3, so
        // only report them as changed when the persisted course actually reflects
        // the requested value — otherwise the audit trail overstates the change.
        const changedFields =
          updated && validated && validated.success
            ? requestedFields.filter((field) => {
                if (field === "instructorId")
                  return updated.instructorId === validated.data.instructorId;
                if (field === "department")
                  return updated.department === validated.data.department;
                return true;
              })
            : requestedFields;
        fireAndForget(
          logAuditAction({
            ...getActorContext(session?.user ?? null),
            ...requestContext,
            actionCode: "COURSE_UPDATED",
            category: "COURSE",
            entityType: "Course",
            entityId: updated?.id ?? courseId,
            entityLabel: updated?.code ?? updated?.name ?? null,
            details: { changedFields },
          }),
        );
      }

      return response;
    }
    case "DELETE": {
      const response = await deleteCourse(request, courseId);

      if (response.status === 204) {
        fireAndForget(
          logAuditAction({
            ...getActorContext(session?.user ?? null),
            ...requestContext,
            actionCode: "COURSE_DELETED",
            category: "COURSE",
            entityType: "Course",
            entityId: courseId,
          }),
        );
      }

      return response;
    }
    default:
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
  }
}
