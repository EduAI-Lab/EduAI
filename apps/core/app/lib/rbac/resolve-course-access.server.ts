import prisma from '~/lib/prisma.server'
import type { CourseAccess, RbacUser } from './types'

export async function resolveCourseAccess(
  user: RbacUser,
  course: { id: string; instructorId: string | null; department: string | null },
): Promise<CourseAccess> {
  if (user.role === 'ADMIN') return 'admin'

  // UNIT_ADMIN: access if course.department is in their authorizedUnits
  if (
    user.role === 'UNIT_ADMIN' &&
    course.department !== null &&
    user.authorizedUnits.includes(course.department)
  ) {
    return 'unit'
  }

  // INSTRUCTOR who owns the course
  if (user.role === 'INSTRUCTOR' && course.instructorId === user.id) return 'instructor'

  // TA via CourseTA junction table
  const ta = await prisma.courseTA.findUnique({
    where: { courseId_userId: { courseId: course.id, userId: user.id } },
  })
  if (ta) return 'ta'

  // Resolve role from Enrollment — covers enrollment-based instructors/TAs
  const enrollment = await prisma.enrollment.findFirst({
    where: { courseId: course.id, userId: user.id, isActive: true },
  })
  if (enrollment) {
    if (enrollment.role === 'INSTRUCTOR') return 'instructor'
    if (enrollment.role === 'TA') return 'ta'
    return 'student'
  }

  return null
}
