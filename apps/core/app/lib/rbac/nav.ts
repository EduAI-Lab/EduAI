import type { NavItem, NavUser } from '~/lib/rbac/types'
import { getQuestionMakerUrl } from '~/lib/extensions/question-maker'
import { getAiTutorAppUrl } from '~/lib/extension-urls'

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

const AI_TUTOR_NAV_ITEM: NavItem = {
  key: 'ai-tutor',
  title: 'AI Tutor',
  url: getAiTutorAppUrl(),
  external: true,
}

const QM_NAV_ROLES = new Set(['INSTRUCTOR', 'ADMIN', 'UNIT_ADMIN'])

const ADMIN_NAV: NavItem[] = [
  { key: 'admin-users', title: 'User Management', url: '/admin/users' },
  { key: 'admin-ai', title: 'AI Management', url: '/admin/ai-models' },
  { key: 'admin-bugs', title: 'Bug Reports', url: '/admin/bug-reports' },
  { key: 'admin-invites', title: 'Invitations', url: '/admin/invitations' },
  { key: 'admin-settings', title: 'Permissions', url: '/admin/settings' },
  { key: 'admin-logs', title: 'Logs', url: '/admin/logs' },
]

/**
 * Unit-admin invitations link. Surfaced only when the `unitAdmins.canInvite`
 * policy flag is on — that gate is applied client-side in `app-sidebar.tsx`
 * (which has the flag values), so this list always includes it for UNIT_ADMIN.
 */
const UNIT_ADMIN_NAV: NavItem[] = [
  { key: 'unitadmin-invites', title: 'Invitations', url: '/unit-admin/invitations' },
]

/** Main sidebar links per rbac-matrix §4, §10–13 shell rules. */
export function getNavForUser(user: NavUser): NavItem[] {
  const role = user.role ?? 'STUDENT'
  const nav = [...CORE_NAV]

  if (role === 'ADMIN') {
    return [...nav, ...ADMIN_NAV]
  }

  if (role === 'UNIT_ADMIN') {
    return [...nav, ...UNIT_ADMIN_NAV]
  }

  // INSTRUCTOR, TA, STUDENT — no platform admin section
  return nav
}

/** ADMIN / UNIT_ADMIN use global chat; others use course-scoped chat (§10). */
export function usesGlobalChat(user: NavUser): boolean {
  const role = user.role ?? 'STUDENT'
  return role === 'ADMIN' || role === 'UNIT_ADMIN'
}

/** Secondary sidebar links (bottom of sidebar). */
export function getNavSecondaryForUser(user: NavUser): NavItem[] {
  const role = user.role ?? 'STUDENT'
  const items: NavItem[] = []

  if (QM_NAV_ROLES.has(role)) {
    items.push(QM_NAV_ITEM)
  }

  items.push(AI_TUTOR_NAV_ITEM)

  return items
}
