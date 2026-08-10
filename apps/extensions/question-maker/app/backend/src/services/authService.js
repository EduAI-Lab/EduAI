/**
 * Authentication service
 * Session validation goes through Core (POST /api/sessions/validate).
 * This service only maintains the thin local user record required for FK
 * integrity within QM (courses, canvas_integrations, canvas_course_mappings).
 */
import { prisma } from '../config/database.js';

const USER_ROW_CACHE_TTL_MS = Number(process.env.USER_ROW_CACHE_TTL_MS) || 15 * 60_000;
const USER_ROW_CACHE_MAX = Number(process.env.USER_ROW_CACHE_MAX) || 5_000;

/**
 * userId -> epoch ms after which the entry goes stale. Records that this
 * process has already written the local row for that user, so the upsert
 * below can be skipped. Per-process: with multiple workers each holds its own
 * map, which only costs one extra (idempotent) upsert per worker per window.
 */
const knownUserIds = new Map();

/**
 * Find or create the local QM user record for a Core-authenticated user.
 * Creates the row on first login. No demo courses are seeded here — every
 * course a user sees must be Core-linked, and those only arrive through the
 * Core-linked import/link flows (or Core auto-import for instructors on
 * /auth/me). Never updates an existing row — only the initial values matter.
 *
 * Because the upsert never updates, repeating it once the row exists is a
 * write that changes nothing, on every authenticated request. Known user ids
 * are memoized for `USER_ROW_CACHE_TTL_MS` so the steady state does no DB work
 * at all. The TTL exists so an out-of-band row deletion self-heals rather than
 * requiring a restart.
 *
 * @param {{ id: string, email: string, name?: string }} coreUser
 * @returns {Promise<object | undefined>} the row on a cache miss, `undefined`
 *   on a hit — callers must not depend on the row coming back.
 */
export async function findOrCreateUser(coreUser) {
  const now = Date.now();
  const expiresAt = knownUserIds.get(coreUser.id);
  if (expiresAt !== undefined && expiresAt > now) return undefined;

  const user = await prisma.user.upsert({
    where: { id: coreUser.id },
    update: {},
    create: {
      id: coreUser.id,
      email: coreUser.email,
      name: coreUser.name ?? null,
    },
  });

  // Crude bound rather than an LRU — entries cost at most one extra upsert to
  // rebuild, so dropping all of them is cheaper than tracking recency.
  if (knownUserIds.size >= USER_ROW_CACHE_MAX) knownUserIds.clear();
  knownUserIds.set(coreUser.id, now + USER_ROW_CACHE_TTL_MS);

  return user;
}

/** Clears the memoized user ids. Test-only — cache state leaks across cases otherwise. */
export function resetUserRowCacheForTests() {
  knownUserIds.clear();
}
