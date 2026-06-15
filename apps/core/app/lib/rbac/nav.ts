import type { NavItem, NavUser } from '~/lib/rbac/types'
import { getQuestionMakerUrl } from '~/lib/extensions/question-maker'

const CORE_NAV: NavItem[] = [
  { key: 'dashboard', title: 'Dashboard', url: '/dashboard' },
  { key: 'courses', title: 'Courses', url: '/courses' },
  { key: 'chat', title: 'Chatbot', url: '/chat' },
]

const QM_NAV_ITEM: NavItem = {
  key: 'question-maker',
  title: 'Question Maker',
  url: getQuestionMakerUrl(),
  external: true,
}

const QM_NAV_ROLES = new Set(['INSTRUCTOR', 'ADMIN', 'UNIT_ADMIN'])

const ADMIN_NAV: NavItem[] = [
  { key: 'admin-users', title: 'User Management', url: '/admin/users' },
  { key: 'admin-ai', title: 'AI Management', url: '/admin/ai-models' },
  { key: 'admin-bugs', title: 'Bug Reports', url: '/admin/bug-reports' },
]

const SETTINGS_NAV: NavItem[] = [
  { key: 'settings', title: 'Settings', url: '/settings' },
]

/** Main sidebar links per rbac-matrix §4, §10–13 shell rules. */
export function getNavForUser(user: NavUser): NavItem[] {
  const role = user.role ?? 'STUDENT'
  const nav = [...CORE_NAV]

  if (QM_NAV_ROLES.has(role)) {
    nav.push(QM_NAV_ITEM)
  }

  if (role === 'ADMIN') {
    return [...nav, ...ADMIN_NAV]
  }

  // UNIT_ADMIN, INSTRUCTOR, TA, STUDENT — no platform admin section
  return nav
}

/** ADMIN / UNIT_ADMIN use global chat; others use course-scoped chat (§10). */
export function usesGlobalChat(user: NavUser): boolean {
  const role = user.role ?? 'STUDENT'
  return role === 'ADMIN' || role === 'UNIT_ADMIN'
}

/** Secondary sidebar links (Settings — all roles §12). */
export function getNavSecondaryForUser(_user: NavUser): NavItem[] {
  return SETTINGS_NAV
}
