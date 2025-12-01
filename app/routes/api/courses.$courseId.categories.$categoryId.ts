import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import prisma from "~/lib/prisma.server";
import { auth } from "~/lib/auth/server";

async function validateCategory(courseId: string, categoryId: string) {
    return prisma.courseCategory.findFirst({
      where: { id: categoryId.trim(), courseId: courseId.trim() },
    });
}

export async function loader({ request, params }: LoaderFunctionArgs) {
    console.log("Params:", params);

    const courseId = params.courseId?.trim();
    const categoryId = params.categoryId?.trim();

  const session = await auth.api.getSession(request);
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const category = await validateCategory(courseId!, categoryId!);
  if (!category) return new Response("Invalid category", { status: 404 });

  return new Response(JSON.stringify(category), {
    status: 200, headers: { "Content-Type": "application/json" }
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
    const courseId = params.courseId?.trim();
    const categoryId = params.categoryId?.trim();
  const session = await auth.api.getSession(request);

  if (!session?.user || session.user.role !== "ADMIN")
    return new Response("Forbidden", { status: 403 });

  const category = await validateCategory(courseId!, categoryId!);
  if (!category) return new Response("Invalid category", { status: 404 });

  switch (request.method) {
    case "PATCH": {
      const body = await request.json();

      const updated = await prisma.courseCategory.update({
        where: { id: categoryId },
        data: {
          name: body.name?.trim(),
          description: body.description ?? null
        }
      });

      return new Response(JSON.stringify(updated), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }

    case "DELETE": {
      await prisma.courseCategory.delete({ where: { id: categoryId }});
      return new Response(null, { status: 204 });
    }

    default:
      return new Response("Method not allowed", { status: 405 });
  }
}
