// resolveCourseAccess is server-only — import from '~/lib/rbac/resolve-course-access.server'
export type {
  CourseAccess,
  UserRole,
  RbacUser,
  RbacCourse,
  NavItem,
  NavItemKey,
  NavUser,
} from './types'
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
  canRenameMaterial,
  canViewTopics,
  canManageTopics,
  isStudentAccess,
} from './permissions'
export { getNavForUser, getNavSecondaryForUser } from './nav'
