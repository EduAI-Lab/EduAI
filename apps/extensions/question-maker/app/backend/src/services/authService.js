/**
 * Authentication service
 * Session validation goes through Core (POST /api/sessions/validate).
 * This service only maintains the thin local user record required for FK
 * integrity within QM (courses, canvas_integrations, canvas_course_mappings).
 */
import { prisma } from '../config/database.js';

/**
 * Reads a non-negative integer from the environment. `Number(x) || fallback`
 * would swallow an explicit `0`, which is exactly how an operator disables the
 * cache, so an empty/absent/invalid value falls back and `0` is honoured.
 */
function readNonNegativeIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

/** Setting either to 0 disables the cache: every request upserts, as before #1388. */
export const USER_ROW_CACHE_TTL_MS = readNonNegativeIntEnv('USER_ROW_CACHE_TTL_MS', 15 * 60_000);
export const USER_ROW_CACHE_MAX = readNonNegativeIntEnv('USER_ROW_CACHE_MAX', 5_000);

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
 * requiring a restart; `forgetUserRow` shortens that window to the next request
 * when a FK violation proves the row is already gone.
 *
 * @param {{ id: string, email: string, name?: string }} coreUser
 * @returns {Promise<void>} nothing — the local row is written for FK integrity
 *   and never read back, and on a cache hit no row is fetched at all.
 */
export async function findOrCreateUser(coreUser) {
  const now = Date.now();
  const expiresAt = knownUserIds.get(coreUser.id);
  if (expiresAt !== undefined && expiresAt > now) return;

  await prisma.user.upsert({
    where: { id: coreUser.id },
    update: {},
    create: {
      id: coreUser.id,
      email: coreUser.email,
      name: coreUser.name ?? null,
    },
  });

  if (USER_ROW_CACHE_TTL_MS === 0 || USER_ROW_CACHE_MAX === 0) return;

  if (knownUserIds.size >= USER_ROW_CACHE_MAX) {
    // Expired entries are dead weight but still count toward the bound, so drop
    // those first. Only if that frees nothing do we flush live entries, which
    // costs one extra (idempotent) upsert per active user.
    for (const [id, entryExpiresAt] of knownUserIds) {
      if (entryExpiresAt <= now) knownUserIds.delete(id);
    }
    if (knownUserIds.size >= USER_ROW_CACHE_MAX) knownUserIds.clear();
  }
  knownUserIds.set(coreUser.id, now + USER_ROW_CACHE_TTL_MS);
}

/**
 * Drops the memoized entry for a user so the next request re-runs the upsert.
 * Called when a FK violation shows the local row is missing — without it the
 * user keeps hitting the same failure for the rest of the TTL window.
 */
export function forgetUserRow(userId) {
  if (userId) knownUserIds.delete(userId);
}

/** Clears the memoized user ids. Test-only — cache state leaks across cases otherwise. */
export function resetUserRowCacheForTests() {
  knownUserIds.clear();
}
