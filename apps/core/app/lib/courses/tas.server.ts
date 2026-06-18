import prisma from "~/lib/prisma.server";
import { AddTASchema, RemoveTASchema, type AddTAInput, type RemoveTAInput } from "./schemas";

// A TA is a course-level role, modelled as an Enrollment with role = "TA".
// There is no longer a separate CourseTA table or platform-level UserRole.TA.

function shapeTA(enrollment: {
  id: string;
  user: { id: string; name: string; email: string };
}) {
  return { id: enrollment.id, user: enrollment.user };
}

export async function getCourseTA(courseId: string) {
  const enrollments = await prisma.enrollment.findMany({
    where: { courseId, role: "TA", isActive: true },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { enrolledAt: "asc" },
  });
  return enrollments.map(shapeTA);
}

export async function addCourseTA(courseId: string, payload: AddTAInput) {
  const parsed = AddTASchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "Invalid input", details: parsed.error.flatten() } as const;
  }

  const user = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true },
  });

  if (!user) return { error: "User not found" } as const;

  const existing = await prisma.enrollment.findUnique({
    where: { courseId_userId: { courseId, userId: parsed.data.userId } },
    select: { role: true, isActive: true },
  });
  if (existing?.role === "TA" && existing.isActive) {
    return { error: "User is already a TA for this course" } as const;
  }

  const enrollment = await prisma.enrollment.upsert({
    where: { courseId_userId: { courseId, userId: parsed.data.userId } },
    create: { courseId, userId: parsed.data.userId, role: "TA", isActive: true },
    update: { role: "TA", isActive: true },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  return { ta: shapeTA(enrollment) } as const;
}

export async function removeCourseTA(courseId: string, payload: RemoveTAInput) {
  const parsed = RemoveTASchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "Invalid input", details: parsed.error.flatten() } as const;
  }

  const result = await prisma.enrollment.updateMany({
    where: { courseId, userId: parsed.data.userId, role: "TA", isActive: true },
    data: { isActive: false },
  });

  if (result.count === 0) return { error: "TA not found for this course" } as const;
  return { success: true } as const;
}
