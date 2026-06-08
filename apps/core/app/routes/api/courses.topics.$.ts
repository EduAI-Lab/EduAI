import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { auth } from "~/lib/auth/server";
import { enforceAdminIfApiKey } from "~/lib/auth/guards.server";
import {
  createCourseTopic,
  deleteCourseTopic,
  getCourseTopics,
} from "~/lib/courses/server";
import prisma from "~/lib/prisma.server";
import { resolveCourseAccess } from "~/lib/rbac/resolve-course-access.server";
import { canManageTopics } from "~/lib/rbac/permissions";

export async function loader({ request, params }: LoaderFunctionArgs) {
  // If an API key is provided, only ADMIN users may proceed
  const { response: apiKeyGuard, session: apiKeySession } = await enforceAdminIfApiKey(request);
  if (apiKeyGuard) return apiKeyGuard;

  const session = apiKeySession ?? await auth.api.getSession(request);

  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const courseId = params.courseId;

  if (!courseId) {
    return new Response(JSON.stringify({ error: "Course ID is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const topics = await getCourseTopics(courseId);

  return new Response(JSON.stringify({ topics }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const courseId = params.courseId;

  if (!courseId) {
    return new Response(JSON.stringify({ error: "Course ID is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // If an API key is provided, only ADMIN users may proceed
  const { response: apiKeyGuard, session: apiKeySession } = await enforceAdminIfApiKey(request);
  if (apiKeyGuard) return apiKeyGuard;

  const session = apiKeySession ?? await auth.api.getSession(request);

  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, professorId: true, department: true },
  });

  if (!course) {
    return new Response(JSON.stringify({ error: "Course not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  let authorizedUnits: string[] = [];
  if (session.user.role === "UNIT_ADMIN") {
    const dbUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { authorizedUnits: true },
    });
    authorizedUnits = dbUser?.authorizedUnits ?? [];
  }
  const rbacUser = {
    id: session.user.id,
    role: session.user.role as import("~/lib/rbac/types").UserRole,
    authorizedUnits,
  };
  const access = await resolveCourseAccess(rbacUser, course);

  if (!canManageTopics(access)) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  switch (request.method) {
    case "POST": {
      const body = await request.json();
      const result = await createCourseTopic(courseId, body);

      if ("error" in result) {
        const status = result.error === "Topic already exists for this course" ? 409 : 400;
        return new Response(JSON.stringify(result), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify(result.topic), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }

    case "DELETE": {

      const body = await request.json();
      const result = await deleteCourseTopic(courseId, body);

      if ("error" in result) {
        const status = result.error === "Topic not found" ? 404 : 400;
        return new Response(JSON.stringify(result), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(null, { status: 204 });
    }

    default:
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
  }
}
