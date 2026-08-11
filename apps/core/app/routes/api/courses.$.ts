import { createCourse, getCourses } from "~/lib/courses/server";
import { auth } from "~/lib/auth/server";
import { fireAndForget, logAuditAction } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { getRequestSession } from "~/lib/auth/request-session.server";

export async function loader({ request }: LoaderFunctionArgs) {
  return getCourses(request);
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "POST") {
    const requestContext = getRequestContext(request);
    const response = await createCourse(request);

    // Emit on the success path only; the service owns auth/validation responses.
    if (response.status === 201) {
      const session = await getRequestSession(request);
      const created = await response
        .clone()
        .json()
        .catch(() => null);
      if (created?.id) {
        fireAndForget(
          logAuditAction({
            ...getActorContext(session?.user ?? null),
            ...requestContext,
            actionCode: "COURSE_CREATED",
            category: "COURSE",
            entityType: "Course",
            entityId: created.id,
            entityLabel: created.code ?? created.name ?? null,
            details: { code: created.code, term: created.term, year: created.year },
          }),
        );
      }
    }

    return response;
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: { "Content-Type": "application/json" },
  });
}
