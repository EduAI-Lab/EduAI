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
import { Prisma } from "@prisma/client";


export async function handleCourseRequest(request: Request) {
  const url = new URL(request.url);
const pathname = url.pathname;
  const { response: apiKeyGuard, session: apiKeySession } = await enforceAdminIfApiKey(request);
  if (apiKeyGuard) return apiKeyGuard;

  switch (request.method) {
    case "GET": {
      const courses = await prisma.course.findMany({
        include: {
          categories: {
            include: {
              topics: true,
            },
          },
        },
      });
      return new Response(JSON.stringify({ courses }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }


    case "POST": {
      const session = apiKeySession ?? await auth.api.getSession(request);
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
      // Create a default category for the new course
      await prisma.courseCategory.create({
        data: {
          courseId: course.id,
          name: "Default",
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
export async function updateCategoryTopic(
  categoryId: string,
  topicId: string,
  data: {
    name?: string;
    description?: string | null;
    order?: number;
  }
) {
  try {
  const updateData: {
    name?: string;
    description?: string | null;
    order?: number;
  } = {};

    if (data.name !== undefined) {
      if (!data.name.trim()) {
        return { error: "Name cannot be empty" };
      }
      updateData.name = data.name.trim();
    }

  
    if (data.description !== undefined) {
      updateData.description = data.description;
    }

    if (data.order !== undefined) {
      updateData.order = data.order;
    }

    const updated = await prisma.topic.update({
      where: {
        id_categoryId: {
          id: topicId,
          categoryId: categoryId,
        },
      },
      data: updateData,
    });

    return { topic: updated };
  } catch (e) {
    console.error(e);
    return { error: "Failed to update topic" };
  }
}

export async function getCategoryTopics(categoryId: string) {
  return prisma.topic.findMany({ 
    where: { categoryId },
    orderBy: { name: "asc" },
  });
}

export async function createCategoryTopic(
  categoryId: string,
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
    const topic = await prisma.topic.create({
      data: {
        categoryId,
        name: parsed.data.name.trim(),
        description: parsed.data.description?.trim() || null,
        order: parsed.data.order,
      },
    });

    return { topic } as const;

  } catch (error: any) {
    if (error?.code === "P2002") {
      return {
        error: "Topic already exists in this category",
      } as const;
    }
    throw error;
  }
}

export async function deleteCategoryTopic(
  categoryId: string,
  payload: DeleteCourseTopicInput
) {
  const parsed = DeleteCourseTopicSchema.safeParse(payload);

  if (!parsed.success) {
    return {
      error: "Invalid input",
      details: parsed.error.flatten(),
    } as const;
  }

  const { topicId, name } = parsed.data;

  const deleteResult = await prisma.topic.deleteMany({
    where: {
      categoryId,
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


export async function renameCategory(categoryId: string, newName: string) {
  const trimmedName = newName.trim();

  if (!trimmedName) {
    return { error: "EMPTY_NAME" };
  }

  try {
    const updatedCategory = await prisma.courseCategory.update({
      where: { id: categoryId },
      data: { name: trimmedName },
    });

    return { category: updatedCategory };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return { error: "NOT_FOUND" };
      }

      if (error.code === "P2002") {
        return { error: "DUPLICATE" };
      }
    }

    console.error("Error renaming category:", error);
    return { error: "UNKNOWN" };
  }
}


export async function deleteCategoryIfEmpty(categoryId: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const topicCount = await tx.topic.count({
        where: { categoryId },
      });

      if (topicCount > 0) {
        return { error: "HAS_TOPICS" };
      }

      await tx.courseCategory.delete({
        where: { id: categoryId },
      });

      return { success: true };
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return { error: "NOT_FOUND" };
    }

    console.error("Error deleting category:", error);
    return { error: "UNKNOWN" };
  }
}