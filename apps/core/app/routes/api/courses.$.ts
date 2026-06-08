import { createCourse, getCourses } from "~/lib/courses/server";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  return getCourses(request);
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "POST") {
    return createCourse(request);
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: { "Content-Type": "application/json" },
  });
}
