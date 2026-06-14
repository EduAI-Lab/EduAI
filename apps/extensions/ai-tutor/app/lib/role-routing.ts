import type { Role } from './types';

export function routeForRole(role: Role): string {
  if (role === 'STUDENT') return '/student';
  if (role === 'INSTRUCTOR') return '/instructor';
  if (role === 'UNIT_ADMIN') return '/instructor';
  if (role === 'TA') return '/instructor';
  return '/admin';
}
