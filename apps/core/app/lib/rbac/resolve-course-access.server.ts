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

  // Resolve course-level role from Enrollment. A TA is an Enrollment with
  // role = 'TA' (there is no longer a separate CourseTA table).
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
