import { resolveCourseAccessGate } from '~/lib/auth/course-access.server'
import type { CourseAccess, RbacUser } from './types'

/**
 * UI/API RBAC wrapper — delegates to the canonical course-access resolver (#293).
 * Returns the string access level consumed by `lib/rbac/permissions.ts`.
 */
export async function resolveCourseAccess(
  user: RbacUser,
  course: { id: string; instructorId: string | null; department: string | null },
): Promise<CourseAccess> {
  void course.instructorId
  void course.department
  const { access } = await resolveCourseAccessGate(
    {
      id: user.id,
      role: user.role,
      authorizedUnits: user.authorizedUnits,
    },
    course.id,
  )
  return access?.level ?? null
}
