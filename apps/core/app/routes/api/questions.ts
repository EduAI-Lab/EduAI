import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { auth } from "~/lib/auth/server";
import { requireServiceKey } from "~/lib/auth/guards.server";
import {
  resolveCourseAccessWithCourse,
  stripAnswerForStudents,
  type AccessLevel,
} from "~/lib/auth/course-access.server";
import prisma from "~/lib/prisma.server";
import {
  createQuestion,
  listQuestions,
} from "~/lib/questions/server";
import { withIdempotency } from "~/lib/idempotency.server";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const courseId = url.searchParams.get("courseId");

  // §9: questions are course-scoped — access resolves against the courseId
  // filter. Reads admit ADMIN / UNIT_ADMIN(D) / INSTRUCTOR(C) / TA(C);
  // students never read questions directly.
  let access: AccessLevel | null = null;

  if (request.headers.get("Authorization")?.startsWith("Bearer ")) {
    const guard = await requireServiceKey(request);
    if (guard) return guard;

    if (!courseId) {
      return json(400, { error: "MISSING_COURSE_ID" });
    }
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true },
    });
    if (!course) {
      return json(404, { error: "COURSE_NOT_FOUND" });
    }
  } else {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return json(401, { error: "Unauthorized" });
    }

    if (!courseId) {
      return json(400, { error: "MISSING_COURSE_ID" });
    }

    const resolved = await resolveCourseAccessWithCourse(session.user, courseId);
    if (!resolved.course) {
      return json(404, { error: "COURSE_NOT_FOUND" });
    }
    access = resolved.access;
    if (!access || access.rank < 1) {
      return json(403, { error: "Forbidden" });
    }
  }

  const topicId = url.searchParams.get("topicId") ?? undefined;
  const testableParam = url.searchParams.get("testable");
  const testable =
    testableParam === "true" ? true : testableParam === "false" ? false : undefined;
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 500);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10) || 0;

  const result = await listQuestions({ courseId, topicId, testable, limit, offset });

  // §19: enforce answer visibility at the serialization layer on every
  // question response path (defensive — student-level access is already 403).
  return json(200, {
    ...result,
    questions: result.questions.map((q) => stripAnswerForStudents(q, access)),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  // POST /api/questions accepts session-cookie auth only (no service-key path).
  // The GET loader above accepts service keys; add a Bearer branch here if a
  // backend service ever needs to create questions without a user session.
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return json(401, { error: "Unauthorized" });
  }

  return withIdempotency({ request, route: "POST /api/questions" }, async (body) => {
    if (typeof body?.courseId === "string" && body.courseId) {
      const { course, access } = await resolveCourseAccessWithCourse(session.user, body.courseId);
      if (!course) {
        return json(404, { error: "COURSE_NOT_FOUND" });
      }
      if (!access || access.rank < 1) {
        return json(403, { error: "Forbidden" });
      }
    }

    const result = await createQuestion(body, session.user.id);

    if ("error" in result) {
      const status =
        result.error === "COURSE_NOT_FOUND" || result.error === "TOPIC_NOT_FOUND" ? 404 : 422;
      return json(status, result);
    }

    return json(201, result);
  });
}
