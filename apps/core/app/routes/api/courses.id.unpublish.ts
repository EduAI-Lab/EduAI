import type { ActionFunctionArgs } from "react-router";
import { setPublishState } from "~/lib/courses/server";
import { withErrorResponse } from "~/lib/errors.server";

export async function action({ request, params }: ActionFunctionArgs) {
  return withErrorResponse(
    async () => {
      if (request.method !== "PATCH") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
          status: 405,
          headers: { "Content-Type": "application/json" },
        });
      }

      const courseId = params.id;
      if (!courseId) {
        return new Response(JSON.stringify({ error: "COURSE_ID_REQUIRED" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      return setPublishState(request, courseId, false);
    },
    { request },
  );
}
