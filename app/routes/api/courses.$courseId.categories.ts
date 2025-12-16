import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import prisma from "~/lib/prisma.server";
import { auth } from "~/lib/auth/server";
import {enforceAdminIfApiKey} from "~/lib/auth/guards.server";

  
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


export async function action({ request, params }: ActionFunctionArgs) {
  const { courseId } = params;

  if (!courseId) {
    return new Response("Missing courseId", { status: 400 });
  }

  const guardResponse = await enforceAdminIfApiKey(request);
  if (guardResponse.response) {
    return guardResponse.response;
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
