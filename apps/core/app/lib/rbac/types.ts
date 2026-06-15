export type CourseAccess = 'admin' | 'unit' | 'instructor' | 'ta' | 'student' | null

export type UserRole = 'ADMIN' | 'UNIT_ADMIN' | 'INSTRUCTOR' | 'TA' | 'STUDENT'

export interface RbacUser {
  id: string
  role: UserRole
  authorizedUnits: string[]
}

export interface RbacCourse {
  id: string
  instructorId: string | null
  department: string | null
}

/** Nav item keys — icons are mapped in `app-sidebar.tsx`. */
export type NavItemKey =
  | 'dashboard'
  | 'courses'
  | 'chat'
  | 'question-maker'
  | 'admin-users'
  | 'admin-ai'
  | 'admin-bugs'
  | 'settings'
  | 'ai-tutor'

export type NavItem = {
  key: NavItemKey
  title: string
  url: string
  external?: boolean
}

export type NavUser = {
  role?: string | null
}
