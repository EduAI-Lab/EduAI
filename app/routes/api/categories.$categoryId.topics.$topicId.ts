import type { ActionFunctionArgs } from "react-router";
import { auth } from "~/lib/auth/server";
import {
    deleteCategoryTopic, updateCategoryTopic
} from "~/lib/courses/server";

export async function action({ request, params }:  ActionFunctionArgs) {
  const { categoryId, topicId } = params;
  
  const session = await auth.api.getSession(request);
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  if (session.user.role !== "admin") {
    return new Response(JSON.stringify({ error: "Forbidden: Admin access required" }), {
      status: 403,
      headers: { "Content-Type": "application/json" }
    });
  }

  if (!categoryId || !topicId) {
    return new Response(JSON.stringify({ error: "Missing parameters" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  switch (request.method) {
    case "PATCH": {
      let body;
      try{
        body = await request.json();
      }
      catch (error){
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }
      

      if ("error" in body) {
        return new Response(JSON.stringify(body), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify(body.topic), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    case "DELETE": {
      const result = await deleteCategoryTopic(categoryId, { topicId });

      if (result.error) {
        const statusCode = result.error === "Topic not found" ? 404 : 400;
        return new Response(JSON.stringify(result), {
          status: statusCode,
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
