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
 * Unit-admin invitations link. Always shown to UNIT_ADMINs, but greyed-out and
 * non-navigating when the `unitAdmins.canInvite` policy flag is off (passed via
 * `opts.canInvite`) — so a disabled flag reads as "an admin turned this off"
 * rather than a missing feature (issue #807). The flag values live client-side;
 * the caller resolves them and threads the result here.
 */
const UNIT_ADMIN_INVITES_KEY = 'unitadmin-invites' as const

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
    const invites: NavItem = {
      key: UNIT_ADMIN_INVITES_KEY,
      title: 'Invitations',
      url: '/unit-admin/invitations',
      disabled: !opts.canInvite,
      disabledReason: opts.canInvite
        ? undefined
        : 'Turned off by your administrator.',
    }
    return [...nav, invites]
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
