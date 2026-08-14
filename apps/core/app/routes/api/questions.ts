import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { requireServiceKey } from "~/lib/auth/guards.server";
import {
  resolveCourseAccessGate,
  stripAnswerForStudents,
  wantsIncludeDeleted,
  type AccessLevel,
} from "~/lib/auth/course-access.server";
import prisma from "~/lib/prisma.server";
import {
  createQuestion,
  listQuestions,
} from "~/lib/questions/server";
import { withIdempotency } from "~/lib/idempotency.server";
import { getRequestSession } from "~/lib/auth/request-session.server";

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
  let includeDeleted = false;

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
    const session = await getRequestSession(request);
    if (!session?.user) {
      return json(401, { error: "Unauthorized" });
    }

    if (!courseId) {
      return json(400, { error: "MISSING_COURSE_ID" });
    }

    // §19 forensics opt-in (#315): ADMIN may pass ?includeDeleted=true to list
    // soft-deleted questions — including those in a soft-deleted course. The
    // access resolver below filters `deletedAt: null` (→ 404 for a deleted
    // course), so an ADMIN read bypasses it here — but still 404s a courseId
    // that never existed. No-op for every non-ADMIN caller.
    includeDeleted = wantsIncludeDeleted(request, session.user);
    if (includeDeleted) {
      const course = await prisma.course.findUnique({
        where: { id: courseId },
        select: { id: true },
      });
      if (!course) {
        return json(404, { error: "COURSE_NOT_FOUND" });
      }
    } else {
      const resolved = await resolveCourseAccessGate(session.user, courseId);
      if (!resolved.course) {
        return json(404, { error: "COURSE_NOT_FOUND" });
      }
      access = resolved.access;
      if (!access || access.rank < 1) {
        return json(403, { error: "Forbidden" });
      }
    }
  }

  const topicId = url.searchParams.get("topicId") ?? undefined;
  const testableParam = url.searchParams.get("testable");
  const testable =
    testableParam === "true" ? true : testableParam === "false" ? false : undefined;
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 500);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10) || 0;

  const result = await listQuestions({ courseId, topicId, testable, limit, offset, includeDeleted });

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
  const session = await getRequestSession(request);
  if (!session?.user) {
    return json(401, { error: "Unauthorized" });
  }

  // Peek courseId before idempotency so course access cannot be skipped on replay.
  const peekedBody = await request
    .clone()
    .json()
    .catch(() => null);
  const bodyPreview =
    peekedBody && typeof peekedBody === "object" && !Array.isArray(peekedBody)
      ? (peekedBody as Record<string, unknown>)
      : null;

  if (typeof bodyPreview?.courseId === "string" && bodyPreview.courseId) {
    const { course, access } = await resolveCourseAccessGate(
      session.user,
      bodyPreview.courseId,
    );
    if (!course) {
      return json(404, { error: "COURSE_NOT_FOUND" });
    }
    if (!access || access.rank < 1) {
      return json(403, { error: "Forbidden" });
    }
  }

  return withIdempotency(
    {
      request,
      route: "POST /api/questions",
      actorId: session.user.id,
      body: bodyPreview,
    },
    async (body) => {
      const result = await createQuestion(body, session.user.id);

      if ("error" in result) {
        const status =
          result.error === "COURSE_NOT_FOUND" || result.error === "TOPIC_NOT_FOUND"
            ? 404
            : 422;
        return json(status, result);
      }

      return json(201, result);
    },
  );
}
