// resolveCourseAccess is server-only — import from '~/lib/rbac/resolve-course-access.server'
export type { CourseAccess, UserRole, RbacUser, RbacCourse } from './types'
export {
  canCreateCourse,
  canEditCourse,
  canPublishCourse,
  canDeleteCourse,
  canViewEnrollments,
  canManageStudents,
  canManageInstructors,
  canUploadMaterial,
  canViewMaterial,
  canDeleteMaterial,
  canViewTopics,
  canManageTopics,
  isStudentAccess,
} from './permissions'
export { getNavForUser } from './nav'
export type { NavItem, NavGroup } from './nav'
