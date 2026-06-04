import prisma from '~/lib/prisma.server'
import type { CourseAccess, RbacUser } from './types'

export async function resolveCourseAccess(
  user: RbacUser,
  course: { id: string; professorId: string; department: string | null },
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

  // PROFESSOR who owns the course
  if (user.role === 'PROFESSOR' && course.professorId === user.id) return 'instructor'

  // TA via CourseTA junction table
  const ta = await prisma.courseTA.findUnique({
    where: { courseId_userId: { courseId: course.id, userId: user.id } },
  })
  if (ta) return 'ta'

  // Student via CourseEnrollment
  const enrollment = await prisma.courseEnrollment.findFirst({
    where: { courseId: course.id, studentId: user.id, isActive: true },
  })
  if (enrollment) return 'student'

  return null
}
