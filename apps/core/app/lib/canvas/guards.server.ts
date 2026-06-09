import { UserRole } from "@prisma/client";

const rateLimitStore = new Map<string, number[]>();

function recordRateLimitHit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (rateLimitStore.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs);
  if (hits.length >= limit) {
    return true;
  }
  hits.push(now);
  rateLimitStore.set(key, hits);
  return false;
}

const SYNC_RATE_LIMIT = Number(process.env.CANVAS_SYNC_RATE_LIMIT ?? 1);
const SYNC_RATE_WINDOW_MS = Number(process.env.CANVAS_SYNC_RATE_WINDOW_MS ?? 30_000);
const LINK_RATE_LIMIT = Number(process.env.CANVAS_LINK_ROSTER_RATE_LIMIT ?? 10);
const LINK_RATE_WINDOW_MS = Number(process.env.CANVAS_LINK_ROSTER_RATE_WINDOW_MS ?? 900_000);

/** Instructor/admin endpoints: connect, courses picker, sync, disconnect. */
export function canManageCanvasIntegration(role: string | null | undefined): boolean {
  return role === UserRole.INSTRUCTOR || role === UserRole.ADMIN;
}

/** Student-number linker: students and TAs only. */
export function canLinkCanvasRoster(role: string | null | undefined): boolean {
  return role === UserRole.STUDENT || role === UserRole.TA;
}

export function isCanvasSyncRateLimited(userId: string): boolean {
  return recordRateLimitHit(`canvas-sync:${userId}`, SYNC_RATE_LIMIT, SYNC_RATE_WINDOW_MS);
}

export function isCanvasLinkRosterRateLimited(userId: string): boolean {
  return recordRateLimitHit(`canvas-link:${userId}`, LINK_RATE_LIMIT, LINK_RATE_WINDOW_MS);
}
