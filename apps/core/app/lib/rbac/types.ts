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
  | 'admin-group'
  | 'admin-users'
  | 'admin-ai'
  | 'admin-bugs'
  | 'admin-chat'
  | 'admin-invites'
  | 'admin-settings'
  | 'admin-logs'
  | 'unitadmin-invites'
  | 'admin-cron'
  | 'settings'
  | 'ai-tutor'

export type NavItem = {
  key: NavItemKey
  title: string
  url: string
  external?: boolean
  /** Render greyed-out and non-navigating (e.g. an admin policy turned it off);
   * the link stays visible so users know the feature exists. See issue #807. */
  disabled?: boolean
  /** Tooltip explaining why a disabled item is greyed out. */
  disabledReason?: string
}

export type NavGroupItem = {
  key: NavItemKey
  title: string
  children: NavItem[]
}

export type NavUser = {
  role?: string | null
}
