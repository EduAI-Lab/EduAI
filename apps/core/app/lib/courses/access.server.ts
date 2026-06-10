import prisma from "~/lib/prisma.server";

type SessionUser = {
  id: string;
  role?: string | null;
};

/** Course the user may manage materials / embedding settings for (admin or enrolled instructor). */
export async function getCourseIfCanManageMaterials(
  user: SessionUser,
  courseId: string,
) {
  if (user.role === "ADMIN") {
    return prisma.course.findUnique({ where: { id: courseId } });
  }

  if (user.role === "INSTRUCTOR") {
    return prisma.course.findFirst({
      where: {
        id: courseId,
        enrollments: {
          some: {
            userId: user.id,
            role: "INSTRUCTOR",
            isActive: true,
          },
        },
      },
    });
  }

  return null;
}
