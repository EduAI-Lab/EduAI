import prisma from "~/lib/prisma.server";
import { AddTASchema, RemoveTASchema, type AddTAInput, type RemoveTAInput } from "./schemas";

/** Platform roles that may receive a course-level TA enrollment (§6). */
const TA_ASSIGNABLE_PLATFORM_ROLES = new Set(["STUDENT", "TA"]);

export async function getCourseTA(courseId: string) {
  const [courseTAs, enrollmentTAs] = await Promise.all([
    prisma.courseTA.findMany({
      where: { courseId },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.enrollment.findMany({
      where: { courseId, role: "TA", isActive: true },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { enrolledAt: "asc" },
    }),
  ]);

  const seen = new Set(courseTAs.map((ta) => ta.userId));
  const fromEnrollments = enrollmentTAs
    .filter((e) => !seen.has(e.userId))
    .map((e) => ({
      id: e.id,
      courseId,
      userId: e.userId,
      createdAt: e.enrolledAt,
      user: e.user,
    }));

  return [...courseTAs, ...fromEnrollments];
}

export async function addCourseTA(courseId: string, payload: AddTAInput) {
  const parsed = AddTASchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "Invalid input", details: parsed.error.flatten() } as const;
  }

  const user = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { role: true },
  });

  if (!user) return { error: "User not found" } as const;
  if (!TA_ASSIGNABLE_PLATFORM_ROLES.has(user.role)) {
    return { error: "User must be a student or TA to assign as course TA" } as const;
  }

  try {
    const ta = await prisma.$transaction(async (tx) => {
      const created = await tx.courseTA.upsert({
        where: {
          courseId_userId: { courseId, userId: parsed.data.userId },
        },
        create: { courseId, userId: parsed.data.userId },
        update: {},
        include: { user: { select: { id: true, name: true, email: true } } },
      });
      await tx.enrollment.upsert({
        where: { courseId_userId: { courseId, userId: parsed.data.userId } },
        create: { courseId, userId: parsed.data.userId, role: "TA", isActive: true },
        update: { role: "TA", isActive: true },
      });
      return created;
    });
    return { ta } as const;
  } catch (error: any) {
    if (error?.code === "P2002") return { error: "User is already a TA for this course" } as const;
    throw error;
  }
}

export async function removeCourseTA(courseId: string, payload: RemoveTAInput) {
  const parsed = RemoveTASchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "Invalid input", details: parsed.error.flatten() } as const;
  }

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.courseTA.findFirst({
      where: { courseId, userId: parsed.data.userId },
      select: { id: true, user: { select: { name: true } } },
    });
    const deleted = await tx.courseTA.deleteMany({
      where: { courseId, userId: parsed.data.userId },
    });

    if (deleted.count > 0) {
      await tx.enrollment.updateMany({
        where: { courseId, userId: parsed.data.userId, role: "TA" },
        data: { isActive: false },
      });
      return { count: deleted.count, ta: existing };
    }

    const enrollment = await tx.enrollment.findUnique({
      where: { courseId_userId: { courseId, userId: parsed.data.userId } },
      select: {
        id: true,
        role: true,
        isActive: true,
        user: { select: { name: true } },
      },
    });

    if (enrollment?.role === "TA" && enrollment.isActive) {
      await tx.enrollment.update({
        where: { courseId_userId: { courseId, userId: parsed.data.userId } },
        data: { isActive: false },
      });
      return {
        count: 1,
        ta: { id: enrollment.id, user: { name: enrollment.user.name } },
      };
    }

    return { count: 0, ta: existing };
  });

  if (result.count === 0) return { error: "TA not found for this course" } as const;
  return {
    success: true,
    taId: result.ta?.id ?? null,
    taName: result.ta?.user?.name ?? null,
  } as const;
}
