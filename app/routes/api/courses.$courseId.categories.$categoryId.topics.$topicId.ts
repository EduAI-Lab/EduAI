import type { ActionFunctionArgs } from "react-router";
import prisma from "~/lib/prisma.server";
import { auth } from "~/lib/auth/server";
import {
  updateCategoryTopic,
  deleteCategoryTopic
} from "~/lib/courses/server";

async function validateCategory(courseId: string, categoryId: string) {
  return prisma.courseCategory.findFirst({
    where: { id: categoryId, courseId }
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { courseId, categoryId, topicId } = params;

  if (!categoryId || !topicId)
    return new Response("Missing parameters", { status: 400 });

  const session = await auth.api.getSession(request);
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  if (session.user.role !== "ADMIN")
    return new Response("Forbidden", { status: 403 });

  const category = await validateCategory(courseId!, categoryId);
  if (!category) return new Response("Invalid category", { status: 404 });

  switch (request.method) {
    case "PATCH": {
      const body = await request.json();
      const result = await updateCategoryTopic(categoryId, topicId, body);

      if ("error" in result)
        return new Response(JSON.stringify(result), {
          status: 400, headers: { "Content-Type": "application/json" }
        });

      return new Response(JSON.stringify(result.topic), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }

    case "DELETE": {
      const result = await deleteCategoryTopic(categoryId, topicId);

      if ("error" in result)
        return new Response(JSON.stringify(result), {
          status: 404, headers: { "Content-Type": "application/json" }
        });

      return new Response(null, { status: 204 });
    }

    default:
      return new Response("Method not allowed", { status: 405 });
  }
}
