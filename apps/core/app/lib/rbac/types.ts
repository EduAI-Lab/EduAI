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
  | 'question-maker'
  | 'admin-users'
  | 'admin-ai'
  | 'admin-bugs'
  | 'admin-chat'
  | 'admin-invites'
  | 'admin-settings'
  | 'admin-logs'
  | 'unitadmin-invites'
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
