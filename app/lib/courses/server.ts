import prisma from "~/lib/prisma.server";
import { auth } from "~/lib/auth/server";
import { CreateCourseSchema, UpdateCourseSchema } from "./schemas";

/**
 * Handles GET, POST for /api/courses
 * and PATCH for /api/courses/:id
 */

export async function handleCourseRequest(request: Request) {
  const url = new URL(request.url);

  switch (request.method) {
    case "GET": {
      const courses = await prisma.course.findMany();
      return new Response(JSON.stringify({ courses }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    case "POST": {
      const session = await auth.api.getSession(request);
      if (!session?.user || session.user.role !== "ADMIN") {
        return new Response("Forbidden: Admins only", { status: 403 });
      }

      const formData = await request.formData();
      const data = {
        name: formData.get("name"),
        code: formData.get("code"),
        term: formData.get("term"),
        year: Number(formData.get("year")),
        aiInstructions: formData.get("aiInstructions") || "",
      };

      const result = CreateCourseSchema.safeParse(data);

      if (!result.success) {
        return new Response(
          JSON.stringify({
            error: "Invalid input",
            details: result.error.flatten(),
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const course = await prisma.course.create({
        data: {
          name: result.data.name,
          code: result.data.code,
          term: result.data.term,
          year: result.data.year,
          professorId: session.user.id,
          aiInstructions: result.data.aiInstructions,
        },
      });

      return new Response(JSON.stringify(course), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }

    case "PATCH": {
      // Extract ID from /api/courses/:id
      const idMatch = url.pathname.match(/\/api\/courses\/([^/]+)/);
      const courseId = idMatch?.[1];

      if (!courseId) {
        return new Response("Missing course ID", { status: 400 });
      }

      const session = await auth.api.getSession(request);
      if (!session?.user) {
        return new Response("Unauthorized", { status: 401 });
      }

      const user = session.user;

      const body = await request.json();
      const result = UpdateCourseSchema.safeParse(body);

      if (!result.success) {
        return new Response(
          JSON.stringify({
            error: "Invalid input",
            details: result.error.flatten(),
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      // Check ownership or admin role
      const course = await prisma.course.findUnique({
        where: { id: courseId },
        select: { professorId: true },
      });

      if (!course) {
        return new Response("Course not found", { status: 404 });
      }

      const isAdmin = user.role === "ADMIN";
      const isProfessor =
        user.role === "PROFESSOR" && user.id === course.professorId;

      if (!isAdmin && !isProfessor) {
        return new Response("Forbidden", { status: 403 });
      }

      const updated = await prisma.course.update({
        where: { id: courseId },
        data: result.data,
      });

      return new Response(JSON.stringify(updated), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    default:
      return new Response("Method not allowed", { status: 405 });
  }
}
