import type { NavItem, NavUser } from '~/lib/rbac/types'
import { getQuestionMakerUrl } from '~/lib/extensions/question-maker'
import { getAiTutorAppUrl } from '~/lib/extension-urls'

const CORE_NAV: NavItem[] = [
  { key: 'dashboard', title: 'Dashboard', url: '/dashboard' },
  { key: 'courses', title: 'Courses', url: '/courses' },
]

const CHATBOT_NAV_ITEM: NavItem = { key: 'chat', title: 'Chatbot', url: '/chat' }

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
  { key: 'admin-cron', title: 'Cron Jobs', url: '/admin/cron-jobs' },
]

const ADMIN_SECONDARY_NAV: NavItem[] = [
  { key: 'admin-chat', title: 'Admin Chatbot', url: '/admin/chat' },
]

/**
 * Unit-admin invitations link. Surfaced only when the `unitAdmins.canInvite`
 * policy flag is on, passed in via `opts.canInvite` (the flag values live
 * client-side; the caller resolves them and threads the result here so the
 * gating decision lives in this one function).
 */
const UNIT_ADMIN_NAV: NavItem[] = [
  { key: 'unitadmin-invites', title: 'Invitations', url: '/unit-admin/invitations' },
]

/** Options that gate policy-dependent nav items. */
export type NavOptions = {
  /** Whether `unitAdmins.canInvite` is on (shows the UNIT_ADMIN Invitations link). */
  canInvite?: boolean
}

/** Main sidebar links per rbac-matrix §4, §10–13 shell rules. */
export function getNavForUser(user: NavUser, opts: NavOptions = {}): NavItem[] {
  const role = user.role ?? 'STUDENT'
  const nav = [...CORE_NAV]

  if (role === 'ADMIN') {
    return [...nav, ...ADMIN_NAV]
  }

  if (role === 'UNIT_ADMIN') {
    return opts.canInvite ? [...nav, ...UNIT_ADMIN_NAV] : [...nav]
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
  const items: NavItem[] = [CHATBOT_NAV_ITEM]

  if (role === 'ADMIN') {
    items.push(...ADMIN_SECONDARY_NAV)
  }

  if (QM_NAV_ROLES.has(role)) {
    items.push(QM_NAV_ITEM)
  }

  items.push(AI_TUTOR_NAV_ITEM)

  return items
}
