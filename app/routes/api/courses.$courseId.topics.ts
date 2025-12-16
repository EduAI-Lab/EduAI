import type { LoaderFunctionArgs } from "react-router";
import prisma from "~/lib/prisma.server";
import { auth } from "~/lib/auth/server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { courseId } = params;

  if (!courseId)
    return new Response("Missing courseId", { status: 400 });

  const session = await auth.api.getSession(request);
  if (!session?.user)
    return new Response("Unauthorized", { status: 401 });

  const topics = await prisma.topic.findMany({
    where: {
      category: {
        courseId: courseId.trim()
      }
    },
    orderBy: [{ categoryId: "asc" }, { order: "asc" }]
  });

  return new Response(JSON.stringify({ topics }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

export async function action() {
  return new Response("Method not allowed", { status: 405 });
}
