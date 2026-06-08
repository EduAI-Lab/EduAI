import prisma from "~/lib/prisma.server";
import { AddTASchema, RemoveTASchema, type AddTAInput, type RemoveTAInput } from "./schemas";

export async function getCourseTA(courseId: string) {
  return prisma.courseTA.findMany({
    where: { courseId },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
  });
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
  if (user.role !== "TA") return { error: "User must have TA role" } as const;

  try {
    const ta = await prisma.courseTA.create({
      data: { courseId, userId: parsed.data.userId },
      include: { user: { select: { id: true, name: true, email: true } } },
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

  const result = await prisma.courseTA.deleteMany({
    where: { courseId, userId: parsed.data.userId },
  });

  if (result.count === 0) return { error: "TA not found for this course" } as const;
  return { success: true } as const;
}
