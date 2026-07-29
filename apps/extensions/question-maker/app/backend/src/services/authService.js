/**
 * Authentication service
 * Session validation goes through Core (POST /api/sessions/validate).
 * This service only maintains the thin local user record required for FK
 * integrity within QM (courses, canvas_integrations, canvas_course_mappings).
 */
import { prisma } from '../config/database.js';

/**
 * Find or create the local QM user record for a Core-authenticated user.
 * Creates the row on first login. No demo courses are seeded here — every
 * course a user sees must be Core-linked, and those only arrive through the
 * Core-linked import/link flows (or Core auto-import for instructors on
 * /auth/me). Never updates an existing row — only the initial values matter.
 *
 * @param {{ id: string, email: string, name?: string }} coreUser
 */
export async function findOrCreateUser(coreUser) {
  return prisma.user.upsert({
    where: { id: coreUser.id },
    update: {},
    create: {
      id: coreUser.id,
      email: coreUser.email,
      name: coreUser.name ?? null,
    },
  });
}
