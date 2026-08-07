import { UserRole } from "@prisma/client";
import { parseEnvInt } from "~/lib/auth/rate-limit.server";

const rateLimitStore = new Map<string, number[]>();

function recordRateLimitHit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  // The `?? []` fallback for an unseen key is unkillable by mutation testing: any non-numeric
  // placeholder value substituted here makes `now - timestamp` evaluate to NaN, and `NaN < windowMs`
  // is always false, so the substituted value is filtered out identically to a real empty array.
  const hits = (rateLimitStore.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs);
  if (hits.length >= limit) {
    return true;
  }
  hits.push(now);
  rateLimitStore.set(key, hits);
  return false;
}

// AUTH-05/CANVAS-13: `Number(env ?? fallback)` turns a non-numeric override
// into NaN, and `hits.length >= NaN` is always false — the limiter silently
// disables itself instead of failing closed. `parseEnvInt` falls back to the
// default on anything non-finite (including "").
const SYNC_RATE_LIMIT = parseEnvInt(process.env.CANVAS_SYNC_RATE_LIMIT, 1);
const SYNC_RATE_WINDOW_MS = parseEnvInt(process.env.CANVAS_SYNC_RATE_WINDOW_MS, 30_000);
const LINK_RATE_LIMIT = parseEnvInt(process.env.CANVAS_LINK_ROSTER_RATE_LIMIT, 10);
const LINK_RATE_WINDOW_MS = parseEnvInt(process.env.CANVAS_LINK_ROSTER_RATE_WINDOW_MS, 900_000);

/** Instructor/admin endpoints: connect, courses picker, sync, disconnect. */
export function canManageCanvasIntegration(role: string | null | undefined): boolean {
  return role === UserRole.INSTRUCTOR || role === UserRole.ADMIN;
}

/** Student-number linker: students only (TAs are STUDENT-platform users). */
export function canLinkCanvasRoster(role: string | null | undefined): boolean {
  return role === UserRole.STUDENT;
}

export function isCanvasSyncRateLimited(userId: string): boolean {
  return recordRateLimitHit(`canvas-sync:${userId}`, SYNC_RATE_LIMIT, SYNC_RATE_WINDOW_MS);
}

export function isCanvasLinkRosterRateLimited(userId: string): boolean {
  return recordRateLimitHit(`canvas-link:${userId}`, LINK_RATE_LIMIT, LINK_RATE_WINDOW_MS);
}

/** Clears in-memory Canvas rate limits between tests. */
export function resetCanvasRateLimitsForTests(): void {
  rateLimitStore.clear();
}
