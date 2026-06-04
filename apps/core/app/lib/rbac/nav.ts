export interface NavItem {
  title: string
  url: string
  icon?: string
}

export interface NavGroup {
  label?: string
  items: NavItem[]
}

const BASE_NAV: NavItem[] = [
  { title: 'Courses', url: '/courses', icon: 'book' },
  { title: 'Chat', url: '/chat', icon: 'message' },
  { title: 'Settings', url: '/settings', icon: 'settings' },
]

const ADMIN_NAV: NavItem[] = [
  { title: 'User Management', url: '/admin/users', icon: 'users' },
  { title: 'AI Management', url: '/admin/ai-models', icon: 'cpu' },
  { title: 'Bug Reports', url: '/admin/bug-reports', icon: 'bug' },
]

// Returns nav items for a given UserRole string. B imports this for app-sidebar.tsx.
// UNIT_ADMIN gets no system-level admin nav (§4 — no User/AI/Bug admin access).
export function getNavForUser(role: string): { main: NavItem[]; admin: NavItem[] } {
  const admin = role === 'ADMIN' ? ADMIN_NAV : []
  return { main: BASE_NAV, admin }
}
