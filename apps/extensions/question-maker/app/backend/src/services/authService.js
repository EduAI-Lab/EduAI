/**
 * Authentication service
 * Session validation goes through Core (POST /api/sessions/validate).
 * This service only maintains the thin local user record required for FK
 * integrity within QM (courses, canvas_integrations, canvas_course_mappings).
 */
import { User } from '../schema/index.js';

/**
 * Find or create the local QM user record for a Core-authenticated user.
 * Creates the row on first login. No demo courses are seeded here — every
 * course a user sees must be Core-linked, and those only arrive through the
 * Core-linked import/link flows (or Core auto-import for instructors on
 * /auth/me).
 *
 * @param {{ id: string, email: string, name?: string }} coreUser
 */
export async function findOrCreateUser(coreUser) {
  const [user] = await User.findOrCreate({
    where: { id: coreUser.id },
    defaults: {
      id: coreUser.id,
      email: coreUser.email,
      name: coreUser.name ?? null,
    },
  });

  return user;
}
