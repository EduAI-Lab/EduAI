import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { auth } from "~/lib/auth/server";
import {
    deleteCategoryTopic, updateCategoryTopic
} from "~/lib/courses/server";

export async function action({ request, params }: ActionFunctionArgs) {
  const { categoryId, topicId } = params;

  if (!categoryId || !topicId) {
    return new Response(JSON.stringify({ error: "Missing parameters" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const session = await auth.api.getSession(request);
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  switch (request.method) {
    case "PATCH": {
      const body = await request.json();
      const result = await updateCategoryTopic(categoryId, topicId, body);

      if ("error" in result) {
        return new Response(JSON.stringify(result), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify(result.topic), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    case "DELETE": {
      const result = await deleteCategoryTopic(categoryId, {topicId});

      if ("error" in result) {
        return new Response(JSON.stringify(result), {
          status: result.error === "Topic not found" ? 404 : 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      return new Response(null, { status: 204 });
    }

    default:
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" }
      });
  }
}
