/**
 * Authentication service
 * Session validation goes through Core (POST /api/sessions/validate).
 * This service only maintains the thin local user record required for FK
 * integrity within QM (courses, canvas_integrations, canvas_course_mappings).
 */
import { User } from '../schema/index.js';
import { seedCoursesForNewUser } from './seedNewUserService.js';

/**
 * Find or create the local QM user record for a Core-authenticated user.
 * Creates the row on first login and seeds default courses for new users.
 *
 * @param {{ id: string, email: string, name?: string }} coreUser
 */
export async function findOrCreateUser(coreUser) {
  const [user, created] = await User.findOrCreate({
    where: { id: coreUser.id },
    defaults: {
      id: coreUser.id,
      email: coreUser.email,
      name: coreUser.name ?? null,
    },
  });

  if (created) {
    await seedCoursesForNewUser(user.id);
  }

  return user;
}
