import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { auth } from "~/lib/auth/server";
import { enforceAdminIfApiKey } from "~/lib/auth/guards.server";
import { getCourseTA, addCourseTA, removeCourseTA } from "~/lib/courses/tas.server";
import prisma from "~/lib/prisma.server";
import { resolveCourseAccess } from "~/lib/rbac/resolve-course-access.server";
import { canManageInstructors } from "~/lib/rbac/permissions";

export async function loader({ request, params }: LoaderFunctionArgs) {
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

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, instructorId: true, department: true },
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

  if (!canManageInstructors(access)) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const tas = await getCourseTA(courseId);
  return new Response(JSON.stringify({ tas }), {
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
    select: { id: true, instructorId: true, department: true },
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

  if (!canManageInstructors(access)) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await request.json();

  switch (request.method) {
    case "POST": {
      const result = await addCourseTA(courseId, body);
      if ("error" in result) {
        const status = result.error === "User is already a TA for this course" ? 409 : 400;
        return new Response(JSON.stringify(result), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(result.ta), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }

    case "DELETE": {
      const result = await removeCourseTA(courseId, body);
      if ("error" in result) {
        const status = result.error === "TA not found for this course" ? 404 : 400;
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
