import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { requireServiceKey } from "~/lib/auth/guards.server";
import {
  resolveCourseAccessGate,
  stripAnswerForStudents,
  wantsIncludeDeleted,
  type AccessLevel,
} from "~/lib/auth/course-access.server";
import prisma from "~/lib/prisma.server";
import { createQuestion, listQuestions } from "~/lib/questions/server";
import { withIdempotency } from "~/lib/idempotency.server";
import {
  MAX_CREATE_QUESTION_BODY_BYTES,
  validateCreateQuestion,
} from "~/lib/questions/schema";
import { getRequestSession } from "~/lib/auth/request-session.server";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function readBoundedJsonBody(request: Request): Promise<
  | { ok: true; body: Record<string, unknown> | null }
  | { ok: false; response: Response }
> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const bytes = Number(declaredLength);
    if (Number.isFinite(bytes) && bytes > MAX_CREATE_QUESTION_BODY_BYTES) {
      return { ok: false, response: json(413, { error: "PAYLOAD_TOO_LARGE" }) };
    }
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: true, body: null };

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_CREATE_QUESTION_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, response: json(413, { error: "PAYLOAD_TOO_LARGE" }) };
    }
    chunks.push(value);
  }

  const raw = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    raw.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(raw));
    const body = value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
    return { ok: true, body };
  } catch {
    return { ok: true, body: null };
  }
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
  const rawLimit = url.searchParams.get("limit");
  const rawOffset = url.searchParams.get("offset");
  const limit = rawLimit === null || rawLimit.trim() === "" ? undefined : Number(rawLimit);
  const offset = rawOffset === null || rawOffset.trim() === "" ? undefined : Number(rawOffset);

  const result = await listQuestions({
    courseId,
    topicId,
    testable,
    limit,
    offset,
    includeDeleted,
  });

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

  // Enforce transport bounds before authentication, parsing, hashing, access
  // checks, or persistence. The streaming limit also covers missing or false
  // Content-Length headers.
  const boundedBody = await readBoundedJsonBody(request);
  if (!boundedBody.ok) return boundedBody.response;

  // POST /api/questions accepts session-cookie auth only (no service-key path).
  // The GET loader above accepts service keys; add a Bearer branch here if a
  // backend service ever needs to create questions without a user session.
  const session = await getRequestSession(request);
  if (!session?.user) {
    return json(401, { error: "Unauthorized" });
  }

  const validation = validateCreateQuestion(boundedBody.body);
  if (!validation.success) return json(422, validation.error);

  // Peek courseId before idempotency so course access cannot be skipped on replay.
  const bodyPreview = boundedBody.body;

  if (typeof bodyPreview?.courseId === "string" && bodyPreview.courseId) {
    const { course, access } = await resolveCourseAccessGate(session.user, bodyPreview.courseId);
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
          result.error === "COURSE_NOT_FOUND" || result.error === "TOPIC_NOT_FOUND" ? 404 : 422;
        return json(status, result);
      }

      return json(201, result);
    },
  );
}
