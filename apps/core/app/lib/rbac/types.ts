export type CourseAccess = 'admin' | 'unit' | 'instructor' | 'ta' | 'student' | null

export type UserRole = 'ADMIN' | 'UNIT_ADMIN' | 'PROFESSOR' | 'TA' | 'STUDENT'

export interface RbacUser {
  id: string
  role: UserRole
  authorizedUnits: string[]
}

export interface RbacCourse {
  id: string
  professorId: string
  department: string | null
}

/** Nav item keys — icons are mapped in `app-sidebar.tsx`. */
export type NavItemKey =
  | 'dashboard'
  | 'courses'
  | 'chat'
  | 'admin-users'
  | 'admin-ai'
  | 'admin-bugs'
  | 'settings'

export type NavItem = {
  key: NavItemKey
  title: string
  url: string
}

export type NavUser = {
  role?: string | null
}
