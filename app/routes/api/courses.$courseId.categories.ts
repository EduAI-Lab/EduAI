import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import prisma from "~/lib/prisma.server";
import { auth } from "~/lib/auth/server";

   ///GET /api/courses/:courseId/categories . it returns all categories for a given course
   /// the loader ensures that data is fetched (GET) before a route renders so we define the GET method here. used for READ operations
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { courseId } = params;

  if (!courseId) {
    return new Response("Missing courseId", { status: 400 });
  }

  const session = await auth.api.getSession(request);
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const categories = await prisma.courseCategory.findMany({
    
    where: { courseId },
    orderBy: { name: "asc" },
  });

  return new Response(JSON.stringify({ categories }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}


   ///POST /api/courses/:courseId/categories. Creates a new category under the course
/// the action handles all the router requests so we define the POST method here . used for Write operations
export async function action({ request, params }: ActionFunctionArgs) {
  const { courseId } = params;

  if (!courseId) {
    return new Response("Missing courseId", { status: 400 });
  }

  const session = await auth.api.getSession(request);
  if (!session?.user || session.user.role !== "ADMIN") {
    return new Response("Forbidden", { status: 403 });
  }

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description =
    typeof body.description === "string" ? body.description : null;

  if (!name) {
    return new Response(
      JSON.stringify({ error: "Category name is required" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // Create the new category
  const category = await prisma.courseCategory.create({
    data: {
      courseId,
      name,
      description,
    },
  });

  return new Response(JSON.stringify(category), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
}
