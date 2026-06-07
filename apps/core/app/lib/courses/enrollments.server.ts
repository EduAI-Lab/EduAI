import prisma from "~/lib/prisma.server";

/**
 * Returns all enrollments (active and inactive) for a course,
 * joined with user data to provide studentEmail and studentName.
 *
 * Does NOT filter by isActive — AI Tutor's enrollmentSync.js
 * handles that filtering on its side. Ordered by enrolledAt ascending.
 */
export async function getCourseEnrollments(courseId: string) {
  return prisma.enrollment.findMany({
    where: { courseId },
    // Join user to populate studentEmail and studentName in the response
    include: {
      user: {
        select: {
          email: true,
          name: true,
        },
      },
    },
    orderBy: { enrolledAt: "asc" },
  });
}
