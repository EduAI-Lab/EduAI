/**
 * PATCH /api/courses/:id/response-style — update responseStyleTags and/or aiInstructions.
 *
 * Auth: ADMIN or INSTRUCTOR, or TA when tas.canSetAiInstructions is on.
 * No GET handler — the course detail loader supplies initial values to the UI;
 * exposing aiInstructions over GET would leak private instructor prompts (#782).
 */
import type { ActionFunctionArgs } from "react-router";

import { auth } from "~/lib/auth/server";
import { resolveCourseAccessWithCourse } from "~/lib/auth/course-access.server";
import { UpdateCourseResponseStyleSchema } from "~/lib/courses/schemas";
import { getPolicy, denyByPolicy } from "~/lib/policy.server";
import prisma from "~/lib/prisma.server";

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "PATCH") {
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

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = UpdateCourseResponseStyleSchema.safeParse(body);
  if (!result.success) {
    return new Response(
      JSON.stringify({ error: "VALIDATION_ERROR", details: result.error.flatten() }),
      { status: 422, headers: { "Content-Type": "application/json" } },
    );
  }

  const user = session.user;
  const { course, access } = await resolveCourseAccessWithCourse(user, courseId);
  if (!course) {
    return new Response(JSON.stringify({ error: "COURSE_NOT_FOUND" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (access?.level === "ta") {
    const taCanSetAi = await getPolicy("tas.canSetAiInstructions");
    if (!taCanSetAi) {
      return denyByPolicy({
        request,
        policyKey: "tas.canSetAiInstructions",
        user,
        action: "course.update.responseStyle",
        courseId,
      });
    }
  } else if (!access || access.rank < 2) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const updated = await prisma.course.update({
    where: { id: courseId },
    data: result.data,
    select: {
      id: true,
      responseStyleTags: true,
      aiInstructions: true,
    },
  });

  return new Response(JSON.stringify(updated), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
