import type { UserRole } from '@eduai/types'
export type { UserRole }

export type CourseAccess = 'admin' | 'unit' | 'instructor' | 'ta' | 'student' | null

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

/** Icons are mapped in `app-sidebar.tsx`. */
export type NavItemKey =
  | 'dashboard'
  | 'courses'
  | 'chat'
  | 'admin-users'
  | 'admin-ai'
  | 'admin-bugs'
  | 'admin-invites'
  | 'settings'

export type NavItem = {
  key: NavItemKey
  title: string
  url: string
}

export type NavUser = {
  role?: string | null
}
