import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { auth } from "~/lib/auth/server";
import { requireServiceKey } from "~/lib/auth/guards.server";
import {
  resolveCourseAccessWithCourse,
  type AccessLevel,
} from "~/lib/auth/course-access.server";
import { canEditCourse } from "~/lib/rbac";
import {
  addQuestionToBank,
  addQuestionsToBank,
  createQuestionBank,
  deleteQuestionBank,
  listBankMemberships,
  listQuestionBanks,
  removeQuestionFromBank,
  updateQuestionBank,
} from "~/lib/question-banks/server";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Nested path after /api/courses/:courseId/banks
 * - "" → GET list / POST create
 * - ":bankId" → PUT update / DELETE
 * - ":bankId/questions" → GET memberships / POST add
 * - ":bankId/questions/:externalQuestionId" → DELETE remove
 */
function parseBanksPath(splat: string | undefined) {
  const rest = (splat || "").replace(/^\/+/, "");
  return rest ? rest.split("/").filter(Boolean) : [];
}

function canViewBanks(access: AccessLevel, isPublished: boolean): boolean {
  if (access.level === "student") return isPublished;
  return true;
}

async function authorizeSession(
  request: Request,
  courseId: string,
  { mutate }: { mutate: boolean },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return {
      errorResponse: json({ error: "Unauthorized" }, 401),
      session: null,
    };
  }

  const { course, access } = await resolveCourseAccessWithCourse(
    session.user,
    courseId,
  );
  if (!course) {
    return {
      errorResponse: json({ error: "COURSE_NOT_FOUND" }, 404),
      session: null,
    };
  }
  if (!access) {
    return {
      errorResponse: json({ error: "Forbidden" }, 403),
      session: null,
    };
  }

  if (mutate) {
    if (!canEditCourse(access.level)) {
      return {
        errorResponse: json({ error: "Forbidden" }, 403),
        session: null,
      };
    }
  } else if (!canViewBanks(access, course.isPublished)) {
    return {
      errorResponse: json({ error: "Forbidden" }, 403),
      session: null,
    };
  }

  return { errorResponse: null, session };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const courseId = params.courseId;
  if (!courseId) return json({ error: "Course ID is required" }, 400);

  if (request.headers.get("Authorization")?.startsWith("Bearer ")) {
    const serviceKeyGuard = await requireServiceKey(request);
    if (serviceKeyGuard) return serviceKeyGuard;
  } else {
    const { errorResponse } = await authorizeSession(request, courseId, {
      mutate: false,
    });
    if (errorResponse) return errorResponse;
  }

  const parts = parseBanksPath(params["*"]);

  if (parts.length === 0) {
    const banks = await listQuestionBanks(courseId);
    return json({ banks });
  }

  if (parts.length === 2 && parts[1] === "questions") {
    const result = await listBankMemberships(courseId, parts[0]);
    if ("error" in result) return json(result, 404);
    return json(result);
  }

  return json({ error: "Not found" }, 404);
}

export async function action({ request, params }: ActionFunctionArgs) {
  const courseId = params.courseId;
  if (!courseId) return json({ error: "Course ID is required" }, 400);

  if (request.headers.get("Authorization")?.startsWith("Bearer ")) {
    const serviceKeyGuard = await requireServiceKey(request);
    if (serviceKeyGuard) return serviceKeyGuard;
  } else {
    const { errorResponse } = await authorizeSession(request, courseId, {
      mutate: true,
    });
    if (errorResponse) return errorResponse;
  }

  const parts = parseBanksPath(params["*"]);
  const method = request.method;

  if (parts.length === 0 && method === "POST") {
    const body = await request.json();
    const result = await createQuestionBank(courseId, body);
    if ("error" in result) {
      const status = result.error === "Course not found" ? 404 : 400;
      return json(result, status);
    }
    return json(result.bank, 201);
  }

  if (parts.length === 1 && parts[0] === "questions") {
    return json({ error: "Not found" }, 404);
  }

  if (parts.length === 1 && method === "PUT") {
    const body = await request.json();
    const result = await updateQuestionBank(courseId, parts[0], body);
    if ("error" in result) {
      const status = result.error === "Question bank not found" ? 404 : 400;
      return json(result, status);
    }
    return json(result.bank);
  }

  if (parts.length === 1 && method === "DELETE") {
    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const result = await deleteQuestionBank(courseId, parts[0], body);
    if ("error" in result) {
      const status = result.error === "Question bank not found" ? 404 : 400;
      return json(result, status);
    }
    return json(result);
  }

  if (parts.length === 2 && parts[1] === "questions" && method === "POST") {
    const body = await request.json();
    if (Array.isArray(body?.memberships)) {
      const result = await addQuestionsToBank(courseId, parts[0], body);
      if ("error" in result) {
        const status = result.error === "Question bank not found" ? 404 : 400;
        return json(result, status);
      }
      return json(result, 201);
    }
    const result = await addQuestionToBank(courseId, parts[0], body);
    if ("error" in result) {
      const status = result.error === "Question bank not found" ? 404 : 400;
      return json(result, status);
    }
    return json(result.membership, 201);
  }

  if (parts.length === 3 && parts[1] === "questions" && method === "DELETE") {
    const source =
      new URL(request.url).searchParams.get("source") || "question-maker";
    const result = await removeQuestionFromBank(
      courseId,
      parts[0],
      parts[2],
      source,
    );
    if ("error" in result) {
      const status =
        result.error === "Question bank not found" ||
        result.error === "Question is not a member of this bank"
          ? 404
          : 400;
      return json(result, status);
    }
    return json(result);
  }

  return json({ error: "Method not allowed" }, 405);
}
