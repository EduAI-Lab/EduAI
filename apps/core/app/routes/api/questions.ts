import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { auth } from "~/lib/auth/server";
import { requireServiceKey } from "~/lib/auth/guards.server";
import prisma from "~/lib/prisma.server";
import {
  createQuestion,
  listQuestions,
} from "~/lib/questions/server";

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.headers.get("Authorization")?.startsWith("Bearer ")) {
    const guard = await requireServiceKey(request);
    if (guard) return guard;
  } else {
    const session = await auth.api.getSession(request);
    if (!session?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (session.user.role === "STUDENT") {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const url = new URL(request.url);
  const courseId = url.searchParams.get("courseId");

  if (!courseId) {
    return new Response(JSON.stringify({ error: "MISSING_COURSE_ID" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
  if (!course) {
    return new Response(JSON.stringify({ error: "COURSE_NOT_FOUND" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const topicId = url.searchParams.get("topicId") ?? undefined;
  const testableParam = url.searchParams.get("testable");
  const testable =
    testableParam === "true" ? true : testableParam === "false" ? false : undefined;
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 500);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10) || 0;

  const result = await listQuestions({ courseId, topicId, testable, limit, offset });

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
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
  if (!["INSTRUCTOR", "TA", "ADMIN"].includes(session.user.role ?? "")) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await request.json();
  const result = await createQuestion(body, session.user.id);

  if ("error" in result) {
    const status =
      result.error === "COURSE_NOT_FOUND" || result.error === "TOPIC_NOT_FOUND" ? 404 : 422;
    return new Response(JSON.stringify(result), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(result), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
}
