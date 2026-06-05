/**
 * GET  /api/courses/:id/rag-settings  — read per-course RAG tuning values.
 * PATCH /api/courses/:id/rag-settings — update ragTopK and/or ragSimilarityThreshold.
 *
 * Auth:
 *   GET  — any authenticated session.
 *   PATCH — ADMIN or INSTRUCTOR only.
 *
 * Both fields are nullable. Sending `null` for a field clears the override and
 * restores the global default.
 */
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";

import { auth } from "~/lib/auth/server";
import { getCourseRagSettings } from "~/lib/courses/server";
import { UpdateCourseRagSettingsSchema } from "~/lib/courses/schemas";
import prisma from "~/lib/prisma.server";

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
export async function loader({ request, params }: LoaderFunctionArgs) {
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

  const settings = await getCourseRagSettings(courseId);
  if (!settings) {
    return new Response(JSON.stringify({ error: "COURSE_NOT_FOUND" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(settings), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------
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

  const session = await auth.api.getSession(request);
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { role } = session.user;
  if (role !== "ADMIN" && role !== "INSTRUCTOR") {
    return new Response(JSON.stringify({ error: "Forbidden: ADMIN or INSTRUCTOR required" }), {
      status: 403,
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

  const result = UpdateCourseRagSettingsSchema.safeParse(body);
  if (!result.success) {
    return new Response(
      JSON.stringify({ error: "VALIDATION_ERROR", details: result.error.flatten() }),
      { status: 422, headers: { "Content-Type": "application/json" } },
    );
  }

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true },
  });
  if (!course) {
    return new Response(JSON.stringify({ error: "COURSE_NOT_FOUND" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const updated = await prisma.course.update({
    where: { id: courseId },
    data: result.data,
    select: { id: true, ragTopK: true, ragSimilarityThreshold: true },
  });

  return new Response(JSON.stringify(updated), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
