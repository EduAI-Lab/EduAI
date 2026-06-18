import type { NavItem, NavUser } from '~/lib/rbac/types'

const CORE_NAV: NavItem[] = [
  { key: 'dashboard', title: 'Dashboard', url: '/dashboard' },
  { key: 'courses', title: 'Courses', url: '/courses' },
  { key: 'chat', title: 'Chatbot', url: '/chat' },
]

const ADMIN_NAV: NavItem[] = [
  { key: 'admin-users', title: 'User Management', url: '/admin/users' },
  { key: 'admin-ai', title: 'AI Management', url: '/admin/ai-models' },
  { key: 'admin-bugs', title: 'Bug Reports', url: '/admin/bug-reports' },
  { key: 'admin-invites', title: 'Invitations', url: '/admin/invitations' },
  { key: 'admin-logs', title: 'Logs', url: '/admin/logs' },
]

const ADMIN_SECONDARY_NAV: NavItem[] = [
  { key: 'admin-chat', title: 'Admin Chatbot', url: '/admin/chat' },
]

const SETTINGS_NAV: NavItem[] = [
  { key: 'settings', title: 'Settings', url: '/settings' },
]

/** Main sidebar links per rbac-matrix §4, §10–13 shell rules. */
export function getNavForUser(user: NavUser): NavItem[] {
  const role = user.role ?? 'STUDENT'

  if (role === 'ADMIN') {
    return [...CORE_NAV, ...ADMIN_NAV]
  }

  // UNIT_ADMIN, INSTRUCTOR, TA, STUDENT — no platform admin section
  return CORE_NAV
}

/** ADMIN / UNIT_ADMIN use global chat; others use course-scoped chat (§10). */
export function usesGlobalChat(user: NavUser): boolean {
  const role = user.role ?? 'STUDENT'
  return role === 'ADMIN' || role === 'UNIT_ADMIN'
}

/** Secondary sidebar links — Admin Chatbot (ADMIN only) above Settings (§12). */
export function getNavSecondaryForUser(user: NavUser): NavItem[] {
  const role = user.role ?? 'STUDENT'
  if (role === 'ADMIN') {
    return [...ADMIN_SECONDARY_NAV, ...SETTINGS_NAV]
  }
  return SETTINGS_NAV
}
