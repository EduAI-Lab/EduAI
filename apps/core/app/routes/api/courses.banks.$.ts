import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { auth } from "~/lib/auth/server";
import { enforceAdminIfApiKey } from "~/lib/auth/guards.server";
import {
  addQuestionToBank,
  createQuestionBank,
  deleteQuestionBank,
  listBankMemberships,
  listQuestionBanks,
  removeQuestionFromBank,
  updateQuestionBank,
} from "~/lib/question-banks/server";

async function requireSession(request: Request) {
  const { response: apiKeyGuard, session: apiKeySession } =
    await enforceAdminIfApiKey(request);
  if (apiKeyGuard) return { errorResponse: apiKeyGuard, session: null };

  const session = apiKeySession ?? (await auth.api.getSession(request));
  if (!session?.user) {
    return {
      errorResponse: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
      session: null,
    };
  }
  return { errorResponse: null, session };
}

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
 * - ":bankId/questions/:questionId" → DELETE remove
 */
function parseBanksPath(splat: string | undefined) {
  const rest = (splat || "").replace(/^\/+/, "");
  return rest ? rest.split("/").filter(Boolean) : [];
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const courseId = params.courseId;
  if (!courseId) return json({ error: "Course ID is required" }, 400);

  const { errorResponse, session } = await requireSession(request);
  if (errorResponse || !session) return errorResponse!;

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

  const { errorResponse, session } = await requireSession(request);
  if (errorResponse || !session) return errorResponse!;

  // Extensions (x-api-key → ADMIN) and professors/admins may mutate banks.
  const role = session.user.role;
  if (role !== "ADMIN" && role !== "PROFESSOR") {
    return json({ error: "Forbidden" }, 403);
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
    const result = await addQuestionToBank(courseId, parts[0], body);
    if ("error" in result) {
      const status =
        result.error === "Question bank not found" ||
        result.error === "Question not found in this course"
          ? 404
          : 400;
      return json(result, status);
    }
    return json(result.membership, 201);
  }

  if (parts.length === 3 && parts[1] === "questions" && method === "DELETE") {
    const result = await removeQuestionFromBank(
      courseId,
      parts[0],
      parts[2],
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
