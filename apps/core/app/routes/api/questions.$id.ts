import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { auth } from "~/lib/auth/server";
import { requireServiceKey } from "~/lib/auth/guards.server";
import { getQuestionById, updateQuestionTestable } from "~/lib/questions/server";

async function resolveAuth(request: Request) {
  if (request.headers.get("Authorization")?.startsWith("Bearer ")) {
    const guard = await requireServiceKey(request);
    return { guard, serviceKey: !guard, session: null };
  }
  const session = await auth.api.getSession(request);
  return { guard: null, serviceKey: false, session };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { guard, serviceKey, session } = await resolveAuth(request);
  if (guard) return guard;

  if (!serviceKey && !session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const question = await getQuestionById(params.id!);
  if (!question) {
    return new Response(JSON.stringify({ error: "QUESTION_NOT_FOUND" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(question), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "PATCH") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { guard, serviceKey, session } = await resolveAuth(request);
  if (guard) return guard;

  if (!serviceKey && !session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!serviceKey && !["INSTRUCTOR", "TA", "ADMIN"].includes(session?.user?.role ?? "")) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await request.json();
  const { testable } = body;

  if (typeof testable !== "boolean") {
    return new Response(
      JSON.stringify({
        error: "VALIDATION_ERROR",
        fields: { testable: "required boolean" },
      }),
      { status: 422, headers: { "Content-Type": "application/json" } }
    );
  }

  const result = await updateQuestionTestable(params.id!, testable);
  if (!result) {
    return new Response(JSON.stringify({ error: "QUESTION_NOT_FOUND" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
