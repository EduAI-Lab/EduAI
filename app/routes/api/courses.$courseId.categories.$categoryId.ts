import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import prisma from "~/lib/prisma.server";
import { auth } from "~/lib/auth/server";
import { enforceAdminIfApiKey } from "~/lib/auth/guards.server";
import { renameCategory } from "~/lib/courses/server";
import { deleteCategoryIfEmpty } from "~/lib/courses/server";

async function validateCategory(courseId: string, categoryId: string) {
    return prisma.courseCategory.findFirst({
      where: { id: categoryId.trim(), courseId: courseId.trim() },
    });
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  
    const courseId = params.courseId?.trim();
    const categoryId = params.categoryId?.trim();

  const session = await auth.api.getSession(request);
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

   if (!courseId || !categoryId) {  
        return new Response("Missing course or category ID", { status: 400 });  
    }  
  const category = await validateCategory(courseId, categoryId);
  if (!category) return new Response("Invalid category", { status: 404 });

  return new Response(JSON.stringify(category), {
    status: 200, headers: { "Content-Type": "application/json" }
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
    const courseId = params.courseId?.trim();
    const categoryId = params.categoryId?.trim();

    if (!courseId || !categoryId) {
    return new Response("Missing course or category ID", { status: 400 });
    }

    const guardResponse = await enforceAdminIfApiKey(request);
    if (guardResponse.response) {
      return guardResponse.response;
    }

  const category = await validateCategory(courseId, categoryId);
  if (!category) return new Response("Invalid category", { status: 404 });

  switch (request.method) {
    case "PATCH": {
      let body: any;

      try {
        body = await request.json();
      } catch {
        return new Response(
          JSON.stringify({ error: "Invalid JSON body" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      if (typeof body.name !== "string" || !body.name.trim()) {
        return new Response(
          JSON.stringify({ error: "Name is required and must be a non-empty string" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const result = await renameCategory(categoryId, body.name);

      if (result.error) {
        if (result.error === "NOT_FOUND") {
          return new Response(
            JSON.stringify({ error: "Invalid category" }),
            { status: 404, headers: { "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({ error: result.error }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify(result.category), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    case "DELETE": {
    const result = await deleteCategoryIfEmpty(categoryId);

    if (result.error) {
      if (result.error === "HAS_TOPICS") {
        return new Response(
          JSON.stringify({ error: "Category has topics" }),
          { status: 409, headers: { "Content-Type": "application/json" } }
        );
      }

      if (result.error === "NOT_FOUND") {
        return new Response(
          JSON.stringify({ error: "Invalid category" }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ error: "Failed to delete category" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(null, { status: 204 });
  }


    default:
      return new Response("Method not allowed", { status: 405 });
  }
}
