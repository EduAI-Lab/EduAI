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
 * GET /api/courses — list active courses.
 */
export async function getCourses(request: Request) {
  const { response: apiKeyGuard } = await enforceAdminIfApiKey(request);
  if (apiKeyGuard) return apiKeyGuard;

  const courses = await prisma.course.findMany({
    where: { deletedAt: null },
  });
  return new Response(JSON.stringify({ courses }), {
    status: 200,
    headers: { "Content-Type": "application/json" } as const,
  });
}

/**
 * POST /api/courses — create a course (admin only).
 */
export async function createCourse(request: Request) {
  const { response: apiKeyGuard, session: apiKeySession } = await enforceAdminIfApiKey(request);
  if (apiKeyGuard) return apiKeyGuard;

  const session = apiKeySession ?? (await auth.api.getSession(request));
  if (!session?.user || session.user.role !== "ADMIN") {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" } as const,
    });
  }

  const formData = await request.formData();
  const instructorUserIds = formData
    .getAll("instructorUserIds")
    .map((value) => String(value))
    .filter(Boolean);

  if (instructorUserIds.length === 0) {
    const rawInstructorUserIds = formData.get("instructorUserIds");
    if (typeof rawInstructorUserIds === "string" && rawInstructorUserIds) {
      try {
        const parsed = JSON.parse(rawInstructorUserIds);
        if (Array.isArray(parsed)) {
          instructorUserIds.push(...parsed.map(String).filter(Boolean));
        } else {
          instructorUserIds.push(rawInstructorUserIds);
        }
      } catch {
        instructorUserIds.push(rawInstructorUserIds);
      }
    }
  }

  const data = {
    name: formData.get("name"),
    code: formData.get("code"),
    section: formData.get("section"),
    term: formData.get("term"),
    year: Number(formData.get("year")),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate") || undefined,
    department: formData.get("department") || undefined,
    description: formData.get("description") || undefined,
    isPublished: formData.get("isPublished") ?? undefined,
    aiInstructions: formData.get("aiInstructions") || "",
    instructorUserIds,
  };

  const result = CreateCourseSchema.safeParse(data);

  if (!result.success) {
    return new Response(
      JSON.stringify({
        error: "Invalid input",
        details: result.error.flatten(),
      }),
      { status: 400, headers: { "Content-Type": "application/json" } as const, },
    );
  }

  const instructors = await prisma.user.findMany({
    where: {
      id: { in: result.data.instructorUserIds },
      role: "INSTRUCTOR",
    },
    select: { id: true },
  });

  if (instructors.length !== result.data.instructorUserIds.length) {
    return new Response(JSON.stringify({ error: "INVALID_INSTRUCTOR" }), {
      status: 422,
      headers: { "Content-Type": "application/json" } as const,
    });
  }

  const course = await prisma.$transaction(async (tx) => {
    const created = await tx.course.create({
      data: {
        name: result.data.name,
        code: result.data.code,
        section: result.data.section,
        term: result.data.term,
        year: result.data.year,
        startDate: result.data.startDate,
        endDate: result.data.endDate,
        department: result.data.department,
        description: result.data.description,
        isPublished: result.data.isPublished,
        aiInstructions: result.data.aiInstructions,
      },
    });

    await tx.enrollment.createMany({
      data: result.data.instructorUserIds.map((userId) => ({
        courseId: created.id,
        userId,
        role: "INSTRUCTOR",
        isActive: true,
      })),
    });

    return created;
  });

  return new Response(JSON.stringify(course), {
    status: 201,
    headers: { "Content-Type": "application/json" } as const,
  });
}

/**
 * PATCH /api/courses/:id — update a course (admin or assigned instructor).
 */
export async function updateCourse(request: Request, courseId: string) {
  const { response: apiKeyGuard, session: apiKeySession } = await enforceAdminIfApiKey(request);
  if (apiKeyGuard) return apiKeyGuard;

  const session = apiKeySession ?? (await auth.api.getSession(request));
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" } as const,
    });
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
      { status: 400, headers: { "Content-Type": "application/json" } as const },
    );
  }

  const existingCourse = await prisma.course.findFirst({
    where: { id: courseId, deletedAt: null },
    select: { id: true },
  });

  if (!existingCourse) {
    return new Response(JSON.stringify({ error: "COURSE_NOT_FOUND" }), {
      status: 404,
      headers: { "Content-Type": "application/json" } as const,
    });
  }

  const isAdmin = user.role === "ADMIN" || user.role === "UNIT_ADMIN";
  let canEdit = isAdmin;

  if (!canEdit) {
    const instructorEnrollment = await prisma.enrollment.findFirst({
      where: {
        courseId,
        userId: user.id,
        role: "INSTRUCTOR",
        isActive: true,
      },
      select: { id: true },
    });
    canEdit = !!instructorEnrollment;
  }

  if (!canEdit) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" } as const,
    });
  }

  const updated = await prisma.course.update({
    where: { id: courseId },
    data: result.data,
  });

  return new Response(JSON.stringify(updated), {
    status: 200,
    headers: { "Content-Type": "application/json" } as const,
  });
}

export async function getCourse(courseId: string) {
  return prisma.course.findFirst({
    where: { id: courseId, deletedAt: null },
  });
}

export async function getCourseTopics(courseId: string) {
  return prisma.courseTopic.findMany({
    where: { courseId, deletedAt: null },
    orderBy: { name: "asc" },
  });
}

export async function getCourseTopic(courseId: string, topicId: string) {
  return prisma.courseTopic.findFirst({
    where: { id: topicId, courseId, deletedAt: null },
  });
}

export async function createCourseTopic(
  courseId: string,
  payload: CreateCourseTopicInput,
) {
  const parsed = CreateCourseTopicSchema.safeParse(payload);

  if (!parsed.success) {
    return {
      status: "400",
      details: parsed.error.flatten(),
    } as const;
  }

  const course = await prisma.course.findFirst({
    where: { id: courseId, deletedAt: null },
    select: { id: true },
  });
  if (!course) {
    return { status: "404" } as const;
  }

  try {
    const topic = await prisma.courseTopic.create({
      data: {
        courseId,
        name: parsed.data.name.trim(),
      },
    });

    return { status: "201", topic } as const;
  } catch (error: any) {
    if (error?.code === "P2002") {
      const existing = await prisma.courseTopic.findFirst({
        where: { courseId, name: parsed.data.name.trim(), deletedAt: null },
        select: { id: true },
      });
      return {
        status: "409",
        existingId: existing?.id ?? null,
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
      status: "400",
      details: parsed.error.flatten(),
    } as const;
  }

  const { topicId, name } = parsed.data;

  const deleteResult = await prisma.courseTopic.updateMany({
    where: {
      courseId,
      deletedAt: null,
      ...(topicId ? { id: topicId } : {}),
      ...(name ? { name } : {}),
    },
    data: { deletedAt: new Date() },
  });

  if (deleteResult.count === 0) {
    return { status: "404" } as const;
  }

  return { status: "204" } as const;
}
