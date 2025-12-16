
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { auth } from "~/lib/auth/server";
import {
  createCategoryTopic,
  deleteCategoryTopic,
  getCategoryTopics,
} from "~/lib/courses/server";
import { enforceAdminIfApiKey } from "~/lib/auth/guards.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { categoryId } = params;

  const session = await auth.api.getSession(request);
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  } 

  if (!categoryId) {
    return new Response(JSON.stringify({ error: "Category ID is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let topics; 
  try {
    const result = await getCategoryTopics(categoryId);
    topics = result;
  } catch (error) {
    return new Response(JSON.stringify({ error: "Database error while fetching topics" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ topics }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { categoryId } = params;
  if (!categoryId) {
    return new Response(JSON.stringify({ error: "Category ID is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const guardResponse = await enforceAdminIfApiKey(request);
  if(guardResponse.response){
    return guardResponse.response;
  }

  switch (request.method) {
    case "POST": {
      try {
        const body = await request.json(); 
        const result = await createCategoryTopic(categoryId, body);

        if ("error" in result) {
          const status = result.error === "Topic already exists in this category" ? 409 : 400;
          return new Response(JSON.stringify({ error: result.error }), {
            status,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify(result.topic), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      } catch (error) {
        console.error("Error creating category topic:", error);
        return new Response(JSON.stringify({ error: "Unable to create topic" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    case "DELETE": {
      try {
        const body = await request.json();
        const result = await deleteCategoryTopic(categoryId, body);

        if ("error" in result) {
          const status = result.error === "Topic not found" ? 404 : 400;
          return new Response(JSON.stringify({ error: result.error }), {
            status,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(null, { status: 204 });
      } catch (error) {
        console.error("Error deleting category topic:", error);
        return new Response(JSON.stringify({ error: "Unable to delete topic" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    default:
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
  }
}
