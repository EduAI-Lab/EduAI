import type { CourseAccess, RbacUser } from './types'

// §5 Course Management
// ADMIN can create any course; UNIT_ADMIN can create courses in their authorized units
export function canCreateCourse(user: RbacUser): boolean {
  return user.role === 'ADMIN' || user.role === 'UNIT_ADMIN'
}

export function canEditCourse(access: CourseAccess): boolean {
  return access === 'admin' || access === 'unit' || access === 'instructor'
}

export function canPublishCourse(access: CourseAccess): boolean {
  return access === 'admin' || access === 'unit' || access === 'instructor'
}

export function canDeleteCourse(access: CourseAccess): boolean {
  return access === 'admin' || access === 'unit' || access === 'instructor'
}

// §6 Enrollment Management
export function canViewEnrollments(access: CourseAccess): boolean {
  return access === 'admin' || access === 'unit' || access === 'instructor' || access === 'ta'
}

export function canManageStudents(access: CourseAccess): boolean {
  return access === 'admin' || access === 'unit' || access === 'instructor'
}

// Instructor add/remove is ADMIN and UNIT_ADMIN only (§6)
export function canManageInstructors(access: CourseAccess): boolean {
  return access === 'admin' || access === 'unit'
}

// §7 Course Materials
export function canUploadMaterial(access: CourseAccess): boolean {
  return access === 'admin' || access === 'unit' || access === 'instructor' || access === 'ta'
}

export function canViewMaterial(access: CourseAccess, isPublished: boolean): boolean {
  if (!access) return false
  if (access === 'student') return isPublished
  return true
}

// TA can only delete their own uploads; instructor/admin/unit can delete any
export function canDeleteMaterial(
  access: CourseAccess,
  userId: string,
  uploadedBy: string,
): boolean {
  if (access === 'admin' || access === 'unit' || access === 'instructor') return true
  if (access === 'ta') return userId === uploadedBy
  return false
}

// §8 Course Topics
export function canViewTopics(access: CourseAccess, isPublished: boolean): boolean {
  if (!access) return false
  if (access === 'student') return isPublished
  return true
}

// A TA may manage topics only when the `tas.canManageTopics` grant is on; pass
// the policy value in from usePolicies() so the UI mirrors backend enforcement.
export function canManageTopics(
  access: CourseAccess,
  taCanManageTopics = false,
): boolean {
  if (access === 'admin' || access === 'unit' || access === 'instructor') return true
  if (access === 'ta') return taCanManageTopics
  return false
}

// §19 Cross-cutting
export function isStudentAccess(access: CourseAccess): boolean {
  return access === 'student'
}
