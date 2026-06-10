import { UserRole, type Prisma } from "@prisma/client";
import prisma from "~/lib/prisma.server";
import { auth } from "~/lib/auth/server";
import { enforceAdminIfApiKey, requireServiceKey } from "~/lib/auth/guards.server";
import {
  buildCourseListFilter,
  getAuthorizedUnits,
  resolveCourseAccessWithCourse,
} from "~/lib/auth/course-access.server";
import {
  CreateCourseSchema,
  UpdateCourseSchema,
  CreateCourseTopicSchema,
  UpdateCourseTopicSchema,
  DeleteCourseTopicSchema,
  type CreateCourseTopicInput,
  type UpdateCourseTopicInput,
  type DeleteCourseTopicInput,
} from "./schemas";


/**
 * GET /api/courses — list active courses.
 *
 * Auth:
 *   - Service key (Authorization: Bearer EDUAI_API_KEY): unrestricted — used by AI Tutor
 *     to list importable courses without requiring an admin session.
 *   - x-api-key / user session: scoped to the caller (§5): ADMIN all;
 *     UNIT_ADMIN authorized units; INSTRUCTOR/TA enrolled; STUDENT enrolled + published.
 */
export async function getCourses(request: Request) {
  // Service key path: AI Tutor and other extensions call this with Authorization: Bearer
  if (request.headers.get("Authorization")?.startsWith("Bearer ")) {
    const serviceKeyGuard = await requireServiceKey(request);
    if (serviceKeyGuard) return serviceKeyGuard;
    const courses = await prisma.course.findMany({ where: { deletedAt: null } });
    return new Response(JSON.stringify({ courses }), {
      status: 200,
      headers: { "Content-Type": "application/json" } as const,
    });
  }

  // x-api-key / session path (admin UI and direct API access)
  const { response: apiKeyGuard, session: apiKeySession } = await enforceAdminIfApiKey(request);
  if (apiKeyGuard) return apiKeyGuard;

  const session = apiKeySession ?? (await auth.api.getSession(request));
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" } as const,
    });
  }

  const courses = await prisma.course.findMany({
    where: await buildCourseListFilter(session.user),
  });
  return new Response(JSON.stringify({ courses }), {
    status: 200,
    headers: { "Content-Type": "application/json" } as const,
  });
}

/**
 * POST /api/courses — create a course (ADMIN, or UNIT_ADMIN within their
 * authorized units).
 */
export async function createCourse(request: Request) {
  const { response: apiKeyGuard, session: apiKeySession } = await enforceAdminIfApiKey(request);
  if (apiKeyGuard) return apiKeyGuard;

  const session = apiKeySession ?? (await auth.api.getSession(request));
  if (!session?.user || !["ADMIN", "UNIT_ADMIN"].includes(session.user.role ?? "")) {
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

  // §5/§19 unit lock: a UNIT_ADMIN can only create courses inside their
  // authorized units — a missing department is never a match.
  if (session.user.role === "UNIT_ADMIN") {
    const units = await getAuthorizedUnits(session.user);
    if (!result.data.department || !units.includes(result.data.department)) {
      return new Response(JSON.stringify({ error: "DEPARTMENT_NOT_AUTHORIZED" }), {
        status: 403,
        headers: { "Content-Type": "application/json" } as const,
      });
    }
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
 * PATCH /api/courses/:id — update a course. Admits ADMIN, UNIT_ADMIN(D),
 * INSTRUCTOR(C) per §5 (rank >= 2).
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

  const { course, access } = await resolveCourseAccessWithCourse(user, courseId);

  if (!course) {
    return new Response(JSON.stringify({ error: "COURSE_NOT_FOUND" }), {
      status: 404,
      headers: { "Content-Type": "application/json" } as const,
    });
  }

  if (!access || access.rank < 2) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" } as const,
    });
  }

  // §6: only ADMIN / UNIT_ADMIN may reassign instructors or change department.
  const updateData: Partial<typeof result.data> = { ...result.data };
  if (access.rank < 3) {
    delete (updateData as any).instructorId;
    delete (updateData as any).department;
  }

  // §5: a UNIT_ADMIN cannot move a course to a unit outside their authorized
  // list (nor strip its department, which would orphan it from their scope).
  if (
    access.level === "unit" &&
    "department" in updateData &&
    updateData.department !== course.department
  ) {
    const units = await getAuthorizedUnits(user);
    if (!updateData.department || !units.includes(updateData.department)) {
      return new Response(JSON.stringify({ error: "DEPARTMENT_NOT_AUTHORIZED" }), {
        status: 403,
        headers: { "Content-Type": "application/json" } as const,
      });
    }
  }

  const newInstructorId = (updateData as any).instructorId as string | undefined;
  const instructorChanging =
    newInstructorId !== undefined && newInstructorId !== course.instructorId;

  const updated = await prisma.$transaction(async (tx) => {
    if (instructorChanging) {
      if (course.instructorId) {
        await tx.enrollment.updateMany({
          where: { courseId, userId: course.instructorId, role: "INSTRUCTOR" },
          data: { isActive: false },
        });
      }
      await tx.enrollment.upsert({
        where: { courseId_userId: { courseId, userId: newInstructorId! } },
        create: { courseId, userId: newInstructorId!, role: "INSTRUCTOR", isActive: true },
        update: { role: "INSTRUCTOR", isActive: true },
      });
    }
    return tx.course.update({
      where: { id: courseId },
      data: updateData,
    });
  });

  return new Response(JSON.stringify(updated), {
    status: 200,
    headers: { "Content-Type": "application/json" } as const,
  });
}

/**
 * DELETE /api/courses/:id — soft-delete (sets `deletedAt`). Admits ADMIN,
 * UNIT_ADMIN(D), INSTRUCTOR(C) per §5.
 */
export async function deleteCourse(request: Request, courseId: string) {
  const { response: apiKeyGuard, session: apiKeySession } = await enforceAdminIfApiKey(request);
  if (apiKeyGuard) return apiKeyGuard;

  const session = apiKeySession ?? (await auth.api.getSession(request));
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" } as const,
    });
  }

  const { course, access } = await resolveCourseAccessWithCourse(session.user, courseId);

  if (!course) {
    return new Response(JSON.stringify({ error: "COURSE_NOT_FOUND" }), {
      status: 404,
      headers: { "Content-Type": "application/json" } as const,
    });
  }

  if (!access || access.rank < 2) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" } as const,
    });
  }

  await prisma.course.update({
    where: { id: courseId },
    data: { deletedAt: new Date() },
  });

  return new Response(null, { status: 204 });
}

export async function getCourse(courseId: string) {
  return prisma.course.findFirst({
    where: { id: courseId, deletedAt: null },
  });
}

/**
 * Returns the `code`s of courses the given user may select in chat.
 *
 * Admins can access every course; everyone else can access only courses they
 * teach, TA, or are actively enrolled in. Used to validate the persisted
 * `lastCourseCode` on restore so a course the user can no longer access is not
 * brought back (#420 review — scope to the user, not the whole database).
 */
export async function getAccessibleCourseCodes(user: {
  id: string;
  role: UserRole | string | null | undefined;
}): Promise<string[]> {
  const where: Prisma.CourseWhereInput =
    user.role === UserRole.ADMIN
      ? { deletedAt: null }
      : {
          deletedAt: null,
          // Instructor, TA, and student access all flow through Enrollment.role
          // after the RBAC refactor (#293) — any active enrollment grants access.
          enrollments: { some: { userId: user.id, isActive: true } },
        };

  const courses = await prisma.course.findMany({
    where,
    select: { code: true },
  });
  return courses.map((course) => course.code);
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
  // #294: null on the service-key path (no user); routes treat a null
  // createdBy as "no owner — TA delete not permitted".
  createdBy: string | null = null,
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
        createdBy,
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

export async function updateCourseTopic(
  courseId: string,
  topicId: string,
  payload: UpdateCourseTopicInput,
) {
  const parsed = UpdateCourseTopicSchema.safeParse(payload);

  if (!parsed.success) {
    return {
      status: "400",
      details: parsed.error.flatten(),
    } as const;
  }

  const existing = await prisma.courseTopic.findFirst({
    where: { id: topicId, courseId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) {
    return { status: "404" } as const;
  }

  try {
    const topic = await prisma.courseTopic.update({
      where: { id: topicId },
      data: { name: parsed.data.name.trim() },
    });
    return { status: "200", topic } as const;
  } catch (error: any) {
    if (error?.code === "P2002") {
      const duplicate = await prisma.courseTopic.findFirst({
        where: { courseId, name: parsed.data.name.trim(), deletedAt: null },
        select: { id: true },
      });
      return {
        status: "409",
        existingId: duplicate?.id ?? null,
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
