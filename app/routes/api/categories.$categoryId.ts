import { get } from "http";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { auth } from "~/lib/auth/server";
import {
  createCategoryTopic,
  deleteCategoryTopic,
  getCategoryTopics,
} from "~/lib/courses/server";
import CoursesPage from "../courses";

  function getParam(request: Request, indexFromEnd: number) {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  return parts[parts.length - indexFromEnd];
}


export async function loader({ request, params }: LoaderFunctionArgs) {
  console.log("---- DEBUG GET TOPICS ----");
  console.log("request.url:", request.url);
  const categoryId = getParam(request,1);
  console.log("Extracted categoryId:", categoryId);

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

  const topics = await getCategoryTopics(categoryId);
  console.log("topics returned from DB:", topics);

  return new Response(JSON.stringify({ topics }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  //  made this function to extract categoryId from URL so that param can get the value correctly
  console.log("---- DEBUG CATEGORY ACTION ----");
  console.log("request.url:", request.url);
  const categoryId = getParam(request,1);
  console.log("Extracted categoryId (action) :", categoryId);


  if (!categoryId) {
    return new Response(JSON.stringify({ error: "Category ID is required" }), {
      status: 400,
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

  switch (request.method) {
    case "POST": {
      if (session.user.role !== "ADMIN") {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }
    
      const body = await request.json(); 
      console.log("post body:", body);
      const result = await createCategoryTopic(categoryId, body);

      if ("error" in result) {
        const status = result.error === "Topic already exists in this category" ? 409 : 400;
        return new Response(JSON.stringify(result), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify(result.topic), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }

    case "DELETE": {
      if (session.user.role !== "ADMIN") {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }

      const body = await request.json();
      const result = await deleteCategoryTopic(categoryId, body);

      if ("error" in result) {
        const status = result.error === "Topic not found" ? 404 : 400;
        return new Response(JSON.stringify(result), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(null, { status: 204 });
    }

    default:
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
  }
}
