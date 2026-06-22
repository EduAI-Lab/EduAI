import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { auth } from "~/lib/auth/server";
import { requireServiceKey } from "~/lib/auth/guards.server";
import {
  resolveCourseAccessWithCourse,
  type AccessLevel,
} from "~/lib/auth/course-access.server";
import prisma from "~/lib/prisma.server";
import { getPolicy } from "~/lib/policy.server";
import {
  createCourseTopic,
  updateCourseTopic,
  deleteCourseTopic,
  getCourseTopics,
  getCourseTopic,
} from "~/lib/courses/server";
import { fireAndForget, logAuditAction } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";

async function topicsGetResponse(courseId: string, topicId?: string) {
  if (topicId) {
    const topic = await getCourseTopic(courseId, topicId);
    if (!topic) {
      return new Response(JSON.stringify({ error: "TOPIC_NOT_FOUND" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify(topic), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const topics = await getCourseTopics(courseId);
  return new Response(JSON.stringify({ topics }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * §8 manage tier: ADMIN / UNIT_ADMIN(D) / INSTRUCTOR(C) (rank >= 2), plus the
 * TA own-only carve-out (§19) — a TA may edit/delete topics they created.
 *
 * When the `tas.canManageTopics` grant is on (passed in as `taCanManageTopics`),
 * a TA may manage ANY topic in the course, superseding the own-only carve-out.
 */
async function canManageTopic(
  access: AccessLevel,
  userId: string,
  courseId: string,
  topicId: string | undefined,
  taCanManageTopics: boolean,
): Promise<boolean> {
  if (access.rank >= 2) return true;
  if (access.level !== "ta") return false;
  // tas.canManageTopics grant: a TA may manage any topic in the course.
  if (taCanManageTopics) return true;
  if (!topicId) return false;
  const topic = await prisma.courseTopic.findFirst({
    where: { id: topicId, courseId, deletedAt: null },
    select: { createdBy: true },
  });
  // Null createdBy = no owner (pre-#294 row or service-key created): TA denied.
  return topic?.createdBy === userId;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const courseId = params.courseId;

  if (!courseId) {
    return new Response(JSON.stringify({ error: "Course ID is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const topicId = params.topicId;

  // Service-key path (extensions): unscoped, never goes through user RBAC.
  if (request.headers.get("Authorization")?.startsWith("Bearer ")) {
    const serviceKeyGuard = await requireServiceKey(request);
    if (serviceKeyGuard) return serviceKeyGuard;
    return topicsGetResponse(courseId, topicId);
  }

  const session = await auth.api.getSession(request);

  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // §8 view tier: any course relationship; students need a published course.
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

  return topicsGetResponse(courseId, topicId);
}

export async function action({ request, params }: ActionFunctionArgs) {
  const courseId = params.courseId;

  if (!courseId) {
    return new Response(JSON.stringify({ error: "Course ID is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let serviceAuth = false;
  if (request.headers.get("Authorization")?.startsWith("Bearer ")) {
    const serviceKeyGuard = await requireServiceKey(request);
    if (serviceKeyGuard) return serviceKeyGuard;
    serviceAuth = true;
  }

  let session = null;
  let access: AccessLevel | null = null;
  if (!serviceAuth) {
    session = await auth.api.getSession(request);

    if (!session?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const resolved = await resolveCourseAccessWithCourse(session.user, courseId);
    if (!resolved.course) {
      return new Response(JSON.stringify({ error: "COURSE_NOT_FOUND" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    access = resolved.access;
  }

  const forbidden = () =>
    new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });

  const requestContext = getRequestContext(request);

  switch (request.method) {
    case "POST": {
      // §8: create topic — ADMIN / UNIT_ADMIN(D) / INSTRUCTOR(C), plus a TA
      // when the tas.canManageTopics grant is on.
      if (
        !serviceAuth &&
        (!access ||
          (access.rank < 2 &&
            !(access.level === "ta" && (await getPolicy("tas.canManageTopics")))))
      ) {
        return forbidden();
      }


      const body = await request.json();
      const result = await createCourseTopic(courseId, body, session?.user.id ?? null);

      if (result.status !== "201") {
        if (result.status === "409") {
          return new Response(
            JSON.stringify({ error: "TOPIC_ALREADY_EXISTS", existingId: result.existingId }),
            { status: 409, headers: { "Content-Type": "application/json" } },
          );
        }
        if (result.status === "404") {
          return new Response(JSON.stringify({ error: "COURSE_NOT_FOUND" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({
            error: "Invalid input",
            ...(result.details ? { details: result.details } : {}),
          }),
          {
            status: Number(result.status),
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      fireAndForget(
        logAuditAction({
          ...getActorContext(session?.user ?? null),
          ...requestContext,
          actionCode: "TOPIC_CREATED",
          category: "TOPIC",
          entityType: "CourseTopic",
          entityId: result.topic.id,
          entityLabel: result.topic.name,
          details: { courseId },
        }),
      );

      return new Response(JSON.stringify(result.topic), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }

    case "PATCH": {
      const topicId = params.topicId;
      if (!topicId) {
        return new Response(JSON.stringify({ error: "TOPIC_ID_REQUIRED" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (
        !serviceAuth &&
        (!access || !session?.user ||
          !(await canManageTopic(
            access,
            session.user.id,
            courseId,
            topicId,
            access.level === "ta" ? await getPolicy("tas.canManageTopics") : false,
          )))
      ) {
        return forbidden();
      }


      const body = await request.json();
      const result = await updateCourseTopic(courseId, topicId, body);

      if (result.status === "200") {
        fireAndForget(
          logAuditAction({
            ...getActorContext(session?.user ?? null),
            ...requestContext,
            actionCode: "TOPIC_UPDATED",
            category: "TOPIC",
            entityType: "CourseTopic",
            entityId: result.topic.id,
            entityLabel: result.topic.name,
            details: { courseId },
          }),
        );

        return new Response(JSON.stringify(result.topic), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (result.status === "409") {
        return new Response(
          JSON.stringify({ error: "TOPIC_ALREADY_EXISTS", existingId: result.existingId }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        );
      }
      if (result.status === "404") {
        return new Response(JSON.stringify({ error: "TOPIC_NOT_FOUND" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          error: "Invalid input",
          ...(result.details ? { details: result.details } : {}),
        }),
        { status: Number(result.status), headers: { "Content-Type": "application/json" } },
      );
    }

    case "DELETE": {
      const body = await request.json();

      if (!serviceAuth) {
        // For TA own-only resolution we need the concrete topic id; the legacy
        // body shape also allows delete-by-name.
        let topicId: string | undefined =
          typeof body?.topicId === "string" ? body.topicId : params.topicId;
        if (!topicId && typeof body?.name === "string") {
          const byName = await prisma.courseTopic.findFirst({
            where: { courseId, name: body.name, deletedAt: null },
            select: { id: true },
          });
          topicId = byName?.id;
        }

        if (
          !access || !session?.user ||
          !(await canManageTopic(
            access,
            session.user.id,
            courseId,
            topicId,
            access.level === "ta" ? await getPolicy("tas.canManageTopics") : false,
          ))
        ) {
          return forbidden();
        }
      }

      const result = await deleteCourseTopic(courseId, body, session?.user.id ?? null);

      if (result.status !== "204") {
        const responseBody =
          result.status === "404"
            ? { error: "Topic not found" }
            : {
                error: "Invalid input",
                ...(result.details ? { details: result.details } : {}),
              };
        return new Response(JSON.stringify(responseBody), {
          status: Number(result.status),
          headers: { "Content-Type": "application/json" },
        });
      }

      fireAndForget(
        logAuditAction({
          ...getActorContext(session?.user ?? null),
          ...requestContext,
          actionCode: "TOPIC_DELETED",
          category: "TOPIC",
          entityType: "CourseTopic",
          entityId: result.topic.id,
          entityLabel: result.topic.name,
          details: { courseId },
        }),
      );

      return new Response(null, { status: 204 });
    }

    default:
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
  }
}
