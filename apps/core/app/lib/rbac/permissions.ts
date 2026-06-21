import type { CourseAccess, RbacUser } from './types'
// Type-only import (erased at runtime) — keeps this module free of the
// prisma-importing policy.server while sharing the PolicyKey union.
import type { PolicyKey } from '~/lib/policy.server'

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

// §5c Course chat visibility
// Single source of truth for "who may read another user's course chats". The
// §5c oversight endpoints (/api/courses/:id/chats, /api/units/:dept/chats,
// /api/chats/:id) resolve staff access through this gate; the legacy listing
// path (/api/chats, /api/chats/:id/messages) is own-chats + ADMIN only and never
// performs staff oversight, so the two cannot drift. Returns the policy flag
// that gates the level, or the sentinels 'always' (ADMIN — no flag needed) /
// 'never' (TA/STUDENT/none — no flag can grant it).
export type ChatViewGate = PolicyKey | 'always' | 'never'

export function courseChatViewPolicyKey(access: CourseAccess): ChatViewGate {
  switch (access) {
    case 'admin':
      return 'always'
    case 'instructor':
      return 'instructors.canViewCourseChats'
    case 'unit':
      return 'unitAdmins.canViewUnitChats'
    default:
      return 'never'
  }
}

// §6 Enrollment & TA management gate. ADMIN/UNIT_ADMIN always; INSTRUCTOR via
// `instructors.canManageEnrollments`; TA/STUDENT never. Mirrors
// courseChatViewPolicyKey so the enrollments and TA routes share one source.
export function manageEnrollmentsPolicyKey(access: CourseAccess): ChatViewGate {
  switch (access) {
    case 'admin':
    case 'unit':
      return 'always'
    case 'instructor':
      return 'instructors.canManageEnrollments'
    default:
      return 'never'
  }
}

// Course-scoped capabilities whose policy gate is resolved centrally, so adding
// a flag is one entry here instead of an edit to every route that enforces it.
export type CourseCapability = 'viewChats' | 'manageEnrollments'

// Resolve the policy gate governing `capability` for a given access level —
// a PolicyKey to check, or the 'always'/'never' sentinels. Pair with `getPolicy`
// on the server, or read the resolved flag from a policy map in the UI.
export function resolvePolicyGate(
  access: CourseAccess,
  capability: CourseCapability,
): ChatViewGate {
  switch (capability) {
    case 'viewChats':
      return courseChatViewPolicyKey(access)
    case 'manageEnrollments':
      return manageEnrollmentsPolicyKey(access)
  }
}

// UI mirror of the backend gate: resolve chat-view permission from a policy map
// (as returned by usePolicies()), so the client hides controls the server 403s.
export function canViewCourseChats(
  access: CourseAccess,
  policies: Partial<Record<PolicyKey, boolean>>,
): boolean {
  const gate = courseChatViewPolicyKey(access)
  if (gate === 'always') return true
  if (gate === 'never') return false
  return policies[gate] ?? false
}

// §19 Cross-cutting
export function isStudentAccess(access: CourseAccess): boolean {
  return access === 'student'
}
