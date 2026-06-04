import prisma from "~/lib/prisma.server";
import { auth } from "~/lib/auth/server";
import { enforceAdminIfApiKey } from "~/lib/auth/guards.server";
import {
  CreateCourseSchema,
  UpdateCourseSchema,
  CreateCourseTopicSchema,
  DeleteCourseTopicSchema,
  type CreateCourseTopicInput,
  type DeleteCourseTopicInput,
} from "./schemas";

/**
 * Handles GET, POST for /api/courses
 * and PATCH for /api/courses/:id
 */

export async function handleCourseRequest(request: Request) {
  const url = new URL(request.url);

  // If an API key is provided, only ADMIN users may proceed
  const { response: apiKeyGuard, session: apiKeySession } = await enforceAdminIfApiKey(request);
  if (apiKeyGuard) return apiKeyGuard;

  switch (request.method) {
    case "GET": {
      const courses = await prisma.course.findMany({ where: { isActive: true } });
      return new Response(JSON.stringify({ courses }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    case "POST": {
      const session = apiKeySession ?? await auth.api.getSession(request);
      const role = session?.user?.role;
      if (!session?.user || (role !== "ADMIN" && role !== "UNIT_ADMIN")) {
        return new Response("Forbidden", { status: 403 });
      }

      const formData = await request.formData();
      const data = {
        name: formData.get("name"),
        code: formData.get("code"),
        term: formData.get("term"),
        year: Number(formData.get("year")),
        department: (formData.get("department") as string) || undefined,
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
          department: result.data.department ?? null,
          professorId: session.user.id,
          aiInstructions: result.data.aiInstructions,
        },
      });

      return new Response(JSON.stringify(course), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }

    case "DELETE": {
      const idMatch = url.pathname.match(/\/api\/courses\/([^/]+)/);
      const courseId = idMatch?.[1];

      if (!courseId) {
        return new Response("Missing course ID", { status: 400 });
      }

      const session = apiKeySession ?? await auth.api.getSession(request);
      if (!session?.user) {
        return new Response("Unauthorized", { status: 401 });
      }

      const user = session.user;
      const isAdmin = user.role === "ADMIN";
      const isUnitAdmin = user.role === "UNIT_ADMIN";

      if (!isAdmin && !isUnitAdmin) {
        return new Response("Forbidden", { status: 403 });
      }

      const existing = await prisma.course.findUnique({
        where: { id: courseId },
        select: { department: true, isActive: true },
      });

      if (!existing || !existing.isActive) {
        return new Response("Course not found", { status: 404 });
      }

      if (isUnitAdmin) {
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: { authorizedUnits: true },
        });
        const authorizedUnits = dbUser?.authorizedUnits ?? [];
        if (!existing.department || !authorizedUnits.includes(existing.department)) {
          return new Response("Forbidden", { status: 403 });
        }
      }

      await prisma.course.update({ where: { id: courseId }, data: { isActive: false } });
      return new Response(null, { status: 204 });
    }

    case "PATCH": {
      // Extract ID from /api/courses/:id
      const idMatch = url.pathname.match(/\/api\/courses\/([^/]+)/);
      const courseId = idMatch?.[1];

      if (!courseId) {
        return new Response("Missing course ID", { status: 400 });
      }

      const session = apiKeySession ?? await auth.api.getSession(request);
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
      const isUnitAdmin = user.role === "UNIT_ADMIN";
      const isProfessor =
        user.role === "PROFESSOR" && user.id === course.professorId;

      if (!isAdmin && !isUnitAdmin && !isProfessor) {
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

export async function getCourseTopics(courseId: string) {
  return prisma.courseTopic.findMany({
    where: { courseId },
    orderBy: { name: "asc" },
  });
}

export async function createCourseTopic(
  courseId: string,
  payload: CreateCourseTopicInput,
) {
  const parsed = CreateCourseTopicSchema.safeParse(payload);

  if (!parsed.success) {
    return {
      error: "Invalid input",
      details: parsed.error.flatten(),
    } as const;
  }

  try {
    const topic = await prisma.courseTopic.create({
      data: {
        courseId,
        name: parsed.data.name.trim(),
      },
    });

    return { topic } as const;
  } catch (error: any) {
    if (error?.code === "P2002") {
      return {
        error: "Topic already exists for this course",
      } as const;
    }
    throw error;
  }
}

export async function deleteCourseTopic(
  courseId: string,
  payload: DeleteCourseTopicInput,
) {
  const parsed = DeleteCourseTopicSchema.safeParse(payload);

  if (!parsed.success) {
    return {
      error: "Invalid input",
      details: parsed.error.flatten(),
    } as const;
  }

  const { topicId, name } = parsed.data;

  const deleteResult = await prisma.courseTopic.deleteMany({
    where: {
      courseId,
      ...(topicId ? { id: topicId } : {}),
      ...(name ? { name } : {}),
    },
  });

  if (deleteResult.count === 0) {
    return {
      error: "Topic not found",
    } as const;
  }

  return { success: true } as const;
}
