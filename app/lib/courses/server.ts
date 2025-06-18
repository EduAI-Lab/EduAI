import prisma from "~/lib/prisma";
import { auth } from "~/lib/auth/server";
import { CreateCourseSchema } from "./schemas";

/**
 * Handles GET and POST requests for /api/courses
 * - GET: returns all courses
 * - POST: creates a new course (admin-only)
 */

export async function handleCourseRequest(request: Request) {
  switch (request.method) {
    case "GET": {
      const courses = await prisma.course.findMany();
      return new Response(JSON.stringify(courses), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    case "POST": {
  const session = await auth.api.getSession(request);

  // Only allowing authenticated users with the ADMIN role
  if (!session?.user || session.user.role !== "ADMIN") {
    return new Response("Forbidden: Admins only", { status: 403 });
  }

  const body = await request.json();
  const result = CreateCourseSchema.safeParse(body);

  // Error validation
  if (!result.success) {
    return new Response(JSON.stringify({
      error: "Invalid input",
      details: result.error.flatten(),
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Create new course
  const course = await prisma.course.create({
    data: {
      name: result.data.name,
    },
  });

  return new Response(JSON.stringify(course), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
}


    default:
      return new Response("Method not allowed", { status: 405 });
  }
}
