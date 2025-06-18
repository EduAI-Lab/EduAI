import prisma from "~/lib/prisma";
import { CreateCourseSchema } from "./schemas";

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
      const body = await request.json();
      const result = CreateCourseSchema.safeParse(body);

      if (!result.success) {
        return new Response(JSON.stringify({
          error: "Invalid input",
          details: result.error.flatten(),
        }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

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
