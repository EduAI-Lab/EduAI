import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import prisma from "~/lib/prisma.server";
import { auth } from "~/lib/auth/server";
import {
  createCategoryTopic,
  getCategoryTopics
} from "~/lib/courses/server";

async function validateCategory(courseId: string, categoryId: string) {
  return prisma.courseCategory.findFirst({
    where: { id: categoryId, courseId }
  });
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { courseId, categoryId } = params;
  const session = await auth.api.getSession(request);
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const category = await validateCategory(courseId!, categoryId!);
  if (!category) return new Response("Invalid category", { status: 404 });

  const topics = await getCategoryTopics(categoryId!);

  return new Response(JSON.stringify({ topics }), {
    status: 200, headers: { "Content-Type": "application/json" }
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { courseId, categoryId } = params;
  const session = await auth.api.getSession(request);

  if (!session?.user || session.user.role !== "ADMIN")
    return new Response("Forbidden", { status: 403 });

  const category = await validateCategory(courseId!, categoryId!);
  if (!category) return new Response("Invalid category", { status: 404 });

  switch (request.method) {
    case "POST": {
      const body = await request.json();
      const result = await createCategoryTopic(categoryId!, body);

      if ("error" in result)
        return new Response(JSON.stringify(result), {
          status: 400, headers: { "Content-Type": "application/json" }
        });

      return new Response(JSON.stringify(result.topic), {
        status: 201, headers: { "Content-Type": "application/json" }
      });
    }

    default:
      return new Response("Method not allowed", { status: 405 });
  }
}
