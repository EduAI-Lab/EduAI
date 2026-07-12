import type { Role } from './types';

/**
 * All supported roles land on the shared, role-aware Dashboard (`/dashboard`)
 * — the AI Tutor equivalent of Core's `/dashboard` and QM's `/dashboard`
 * (issue #938). Role-specific stats/panels are handled inside the dashboard
 * itself, not by routing to a different URL per role.
 */
export function routeForRole(_role: Role): string {
  return '/dashboard';
}
