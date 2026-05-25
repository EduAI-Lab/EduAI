import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { auth } from "~/lib/auth/server";
import { enforceAdminIfApiKey, requireServiceKey } from "~/lib/auth/guards.server";
import {
  createCourseTopic,
  deleteCourseTopic,
  getCourseTopics,
  getCourseTopic,
} from "~/lib/courses/server";

async function topicsGetResponse(courseId: string, topicId?: string) {
  if (topicId) {
    const topic = await getCourseTopic(courseId, topicId);
    if (!topic) {
      return new Response(JSON.stringify({ error: "TOPIC_NOT_FOUND" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify(topic), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const topics = await getCourseTopics(courseId);
  return new Response(JSON.stringify({ topics }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const courseId = params.courseId;

  if (!courseId) {
    return new Response(JSON.stringify({ error: "Course ID is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const topicId = params.topicId;

  if (request.headers.get("Authorization")?.startsWith("Bearer ")) {
    const serviceKeyGuard = await requireServiceKey(request);
    if (serviceKeyGuard) return serviceKeyGuard;
    return topicsGetResponse(courseId, topicId);
  }

  const { response: apiKeyGuard, session: apiKeySession } = await enforceAdminIfApiKey(request);
  if (apiKeyGuard) return apiKeyGuard;

  const session = apiKeySession ?? (await auth.api.getSession(request));

  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return topicsGetResponse(courseId, topicId);
}

export async function action({ request, params }: ActionFunctionArgs) {
  const courseId = params.courseId;

  if (!courseId) {
    return new Response(JSON.stringify({ error: "Course ID is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  
  let serviceAuth = false;
  if (request.headers.get("Authorization")?.startsWith("Bearer ")) {
    const serviceKeyGuard = await requireServiceKey(request);
    if (serviceKeyGuard) return serviceKeyGuard;
    serviceAuth = true;
  }

  let session = null;
  if (!serviceAuth) {
    const { response: apiKeyGuard, session: apiKeySession } = await enforceAdminIfApiKey(request);
    if (apiKeyGuard) return apiKeyGuard;

    session = apiKeySession ?? await auth.api.getSession(request);

    if (!session?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  switch (request.method) {
    case "POST": {
      if (!serviceAuth && session?.user.role !== "ADMIN") {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }

      const body = await request.json();
      const result = await createCourseTopic(courseId, body);

      if ("error" in result) {
        if (result.error === "TOPIC_ALREADY_EXISTS") {
          return new Response(
            JSON.stringify({ error: "TOPIC_ALREADY_EXISTS", existingId: result.existingId }),
            { status: 409, headers: { "Content-Type": "application/json" } }
          );
        }
        if (result.error === "COURSE_NOT_FOUND") {
          return new Response(JSON.stringify({ error: "COURSE_NOT_FOUND" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify(result), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify(result.topic), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }

    case "DELETE": {
      if (!serviceAuth && (!session?.user || session.user.role !== "ADMIN")) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }

      const body = await request.json();
      const result = await deleteCourseTopic(courseId, body);

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
