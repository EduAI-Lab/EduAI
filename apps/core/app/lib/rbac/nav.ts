import type { NavItem, NavUser } from '~/lib/rbac/types'
import { getQuestionMakerUrl } from '~/lib/extensions/question-maker'
import { getAiTutorAppUrl } from '~/lib/extension-urls'

const CORE_NAV: NavItem[] = [
  { key: 'dashboard', title: 'Dashboard', url: '/dashboard' },
  { key: 'courses', title: 'Courses', url: '/courses' },
]

const CHAT_NAV_ITEM: NavItem = {
  key: 'chat',
  title: 'Chatbot',
  url: '/chat',
}

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
  { key: 'admin-logs', title: 'Logs', url: '/admin/logs' },
]

/** Main sidebar links per rbac-matrix §4, §10–13 shell rules. */
export function getNavForUser(user: NavUser): NavItem[] {
  const role = user.role ?? 'STUDENT'
  const nav = [...CORE_NAV]

  if (role === 'ADMIN') {
    return [...nav, ...ADMIN_NAV]
  }

  if (role === 'UNIT_ADMIN') {
    return [...nav, { key: 'admin-invites', title: 'Invitations', url: '/admin/invitations' }]
  }

  // INSTRUCTOR, TA, STUDENT — no platform admin section
  return nav
}

/** Secondary sidebar links (bottom of sidebar). */
export function getNavSecondaryForUser(user: NavUser): NavItem[] {
  const role = user.role ?? 'STUDENT'
  const items: NavItem[] = []

  // Chatbot link is available for all roles
  items.push(CHAT_NAV_ITEM)

  if (QM_NAV_ROLES.has(role)) {
    items.push(QM_NAV_ITEM)
  }

  items.push(AI_TUTOR_NAV_ITEM)

  return items
}
