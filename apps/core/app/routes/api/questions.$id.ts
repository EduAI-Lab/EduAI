import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { auth } from "~/lib/auth/server";
import { requireServiceKey } from "~/lib/auth/guards.server";
import {
  resolveCourseAccess,
  stripAnswerForStudents,
} from "~/lib/auth/course-access.server";
import { getQuestionById, updateQuestionTestable } from "~/lib/questions/server";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function resolveAuth(request: Request) {
  if (request.headers.get("Authorization")?.startsWith("Bearer ")) {
    const guard = await requireServiceKey(request);
    return { guard, serviceKey: !guard, session: null };
  }
  const session = await auth.api.getSession({ headers: request.headers });
  return { guard: null, serviceKey: false, session };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { guard, serviceKey, session } = await resolveAuth(request);
  if (guard) return guard;

  if (!serviceKey && !session?.user) {
    return json(401, { error: "Unauthorized" });
  }

  const question = await getQuestionById(params.id!);
  if (!question) {
    return json(404, { error: "QUESTION_NOT_FOUND" });
  }

  // §9: user-OAuth reads admit ADMIN / UNIT_ADMIN(D) / INSTRUCTOR(C) / TA(C).
  // Students never read questions directly — 403 at rank 0 or no relationship.
  if (!serviceKey && session?.user) {
    const access = await resolveCourseAccess(session.user, question.courseId);
    if (!access || access.rank < 1) {
      return json(403, { error: "Forbidden" });
    }
    // §19: strip at the serialization layer regardless of route guards.
    return json(200, stripAnswerForStudents(question, access));
  }

  return json(200, question);
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "PATCH") {
    return json(405, { error: "Method not allowed" });
  }

  const { guard, serviceKey, session } = await resolveAuth(request);
  if (guard) return guard;

  if (!serviceKey && !session?.user) {
    return json(401, { error: "Unauthorized" });
  }

  // §9: user-OAuth edits admit ADMIN / UNIT_ADMIN(D) / INSTRUCTOR(C), plus
  // the TA own-only carve-out (#301 — `Question.createdBy` exists today):
  // a TA may edit their own question within a course where they hold
  // EnrollmentRole=TA. Service-key path (QM) is unchanged and skips this.
  if (!serviceKey && session?.user) {
    const question = await getQuestionById(params.id!);
    if (!question) {
      return json(404, { error: "QUESTION_NOT_FOUND" });
    }
    const access = await resolveCourseAccess(session.user, question.courseId);
    const isOwnTa = access?.level === "ta" && question.createdBy === session.user.id;
    if (!access || (access.rank < 2 && !isOwnTa)) {
      return json(403, { error: "Forbidden" });
    }
  }

  const body = await request.json();
  const { testable } = body;

  if (typeof testable !== "boolean") {
    return json(422, {
      error: "VALIDATION_ERROR",
      fields: { testable: "required boolean" },
    });
  }

  const result = await updateQuestionTestable(params.id!, testable);
  if (!result) {
    return json(404, { error: "QUESTION_NOT_FOUND" });
  }

  return json(200, result);
}
