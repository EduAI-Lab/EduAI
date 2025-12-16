import type { ActionFunctionArgs } from "react-router";
import prisma from "~/lib/prisma.server";
import {
  updateCategoryTopic,
  deleteCategoryTopic
} from "~/lib/courses/server";
import { enforceAdminIfApiKey } from "~/lib/auth/guards.server";

async function validateCategory(courseId: string, categoryId: string) {
  try {
    return await prisma.courseCategory.findFirst({
      where: { id: categoryId, courseId }
    });
  } catch (error) {
    console.error("Error validating category:", error);
    throw new Error("Failed to validate category");
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { courseId, categoryId, topicId } = params;

  if (!courseId || !categoryId || !topicId)
    return new Response("Missing parameters", { status: 400 });

  const guardResponse = await enforceAdminIfApiKey(request);
  if(guardResponse.response){
    return guardResponse.response;
  }

  let category;
  try{
    category = await validateCategory(courseId, categoryId);
  } catch(error){
  return new Response(JSON.stringify({ error: "Database error" }), {
    status: 500, headers: { "Content-Type": "application/json" }
  });
  }
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

   case "DELETE":{
      try {
        const result = await deleteCategoryTopic(categoryId, { topicId });

        if ("error" in result) {
          const status =
            result.error === "Topic not found" ? 404 : 400;

          return new Response(JSON.stringify(result), {
            status,
            headers: { "Content-Type": "application/json" }
          });
        }

        return new Response(null, { status: 204 });
      } catch (error) {
        console.error("Error deleting category topic:", error);
        return new Response(JSON.stringify({ error: "Unable to delete topic" }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    default:
      return new Response("Method not allowed", { status: 405 });
  }
}
