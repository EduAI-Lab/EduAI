import type { Role } from './types';

export function routeForRole(role: Role): string {
  if (role === 'STUDENT') return '/student';
  if (role === 'INSTRUCTOR') return '/instructor';
  if (role === 'UNIT_ADMIN') return '/instructor';
  if (role === 'TA') return '/instructor';
  // Admins land on the shared Courses dashboard (admin ⊇ instructor); the
  // admin-only Bug Reports console stays reachable via its own nav item (/admin).
  if (role === 'ADMIN') return '/instructor';
  return '/admin';
}
