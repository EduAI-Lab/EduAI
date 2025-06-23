import prisma from "~/lib/prisma";
import { auth } from "~/lib/auth/server";
import { UpdateCourseSchema } from "./schemas";

// TODO: This function is ready to be wired into a Vite-compatible API handler.
// Next steps:
// - Add frontend UI to allow course edits by admins and professors

export async function updateCourse(request: Request, courseId: string) {
  // Auth: only admins or professors should update a course
  const session = await auth.api.getSession(request);

  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const user = session.user;

  const body = await request.json();
  const result = UpdateCourseSchema.safeParse(body);

  if (!result.success) {
    return new Response(JSON.stringify({
      error: "Invalid input",
      details: result.error.flatten(),
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Fetch course to check access
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { professorId: true },
  });

  if (!course) {
    return new Response("Course not found", { status: 404 });
  }

  // Only ADMINs or the professor who owns the course can update
  const isAdmin = user.role === "ADMIN";
  const isProfessor = user.role === "PROFESSOR" && user.id === course.professorId;

  if (!isAdmin && !isProfessor) {
    return new Response("Forbidden", { status: 403 });
  }

  // Update course
  const updated = await prisma.course.update({
    where: { id: courseId },
    data: result.data,
  });

  return new Response(JSON.stringify(updated), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
