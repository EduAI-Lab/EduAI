import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { auth } from "~/lib/auth/server";
import {
  createCourseTopic,
  deleteCourseTopic,
  getCourseTopics,
} from "~/lib/courses/server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const session = await auth.api.getSession(request);

  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const categoryId = params.categoryId;

  if (!categoryId) {
    return new Response(JSON.stringify({ error: "Course ID is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const topics = await getCourseTopics(categoryId);

  return new Response(JSON.stringify({ topics }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const categoryId = params.categoryId;

  if (!categoryId) {
    return new Response(JSON.stringify({ error: "category ID is required" }), {
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
      const result = await createCourseTopic(categoryId, body);

      if ("error" in result) {
        const status = result.error === "Topic already exists for this course" ? 409 : 400;
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
      const result = await deleteCourseTopic(categoryId, body);

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
