import prisma from "~/lib/prisma.server";

type SessionUser = {
  id: string;
  role?: string | null;
};

/** Course the user may manage materials / embedding settings for (admin or owning professor). */
export async function getCourseIfCanManageMaterials(
  user: SessionUser,
  courseId: string,
) {
  if (user.role === "ADMIN") {
    return prisma.course.findUnique({ where: { id: courseId } });
  }

  if (user.role === "PROFESSOR") {
    return prisma.course.findFirst({
      where: { id: courseId, professorId: user.id },
    });
  }

  return null;
}
