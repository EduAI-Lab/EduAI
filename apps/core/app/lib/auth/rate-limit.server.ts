import { randomUUID } from "node:crypto";
import { rateLimitRedis } from "~/lib/queue/connection.server";

/** Per-process fallback used by session validation and Redis-backed limits. */
const store = new Map<string, number[]>();

export type RateLimitResult = {
  limited: boolean;
  retryAfter: number;
};

export type ChatRateLimitConfig = {
  limit: number;
  windowMs: number;
};

/**
 * Number(process.env.X ?? fallback) only falls back on null/undefined. Guard
 * against blank and non-finite values so configuration cannot silently become
 * zero or NaN.
 */
export function parseEnvInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getChatRateLimitConfig(): ChatRateLimitConfig {
  const legacyWindowMs = parseEnvInt(process.env.CHAT_RATE_WINDOW_MS, 60_000);
  return {
    limit: parseEnvInt(process.env.CHAT_RATE_LIMIT, 100),
    windowMs: parseEnvInt(process.env.CHAT_RATE_LIMIT_WINDOW_MS, legacyWindowMs),
  };
}

// Bound the process-local fallback (#990). The stale window is comfortably
// larger than configured request windows, and hot-key eviction targets 90% of
// the cap so sustained traffic does not trigger a sweep on every insert.
const MAX_STORE_KEYS = parseEnvInt(process.env.RATE_LIMIT_MAX_KEYS, 50_000);
const STALE_ENTRY_MS = 60 * 60_000;
const EVICTION_TARGET_KEYS = Math.floor(MAX_STORE_KEYS * 0.9);
const REDIS_OPERATION_TIMEOUT_MS = 300;

const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
local cutoff = now - window_ms

redis.call("ZREMRANGEBYSCORE", key, "-inf", cutoff)
local count = redis.call("ZCARD", key)

if count >= limit then
  local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
  local retry_after = 1
  if oldest[2] then
    retry_after = math.max(1, math.ceil((tonumber(oldest[2]) + window_ms - now) / 1000))
  end
  redis.call("PEXPIRE", key, window_ms)
  return {1, retry_after}
end

redis.call("ZADD", key, now, member)
redis.call("PEXPIRE", key, window_ms)
return {0, 0}
`;

function evictStaleEntries(now: number): void {
  for (const [key, hits] of store) {
    const lastHit = hits[hits.length - 1];
    if (lastHit === undefined || now - lastHit > STALE_ENTRY_MS) {
      store.delete(key);
    }
  }
}

function boundMemoryStore(now: number): void {
  if (store.size <= MAX_STORE_KEYS) return;

  evictStaleEntries(now);
  // Updating a Map value does not change insertion order, so this remains the
  // existing oldest-inserted fallback rather than claiming true LRU behavior.
  for (const oldestKey of store.keys()) {
    if (store.size <= EVICTION_TARGET_KEYS) break;
    store.delete(oldestKey);
  }
}

function checkMemoryRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now()
): RateLimitResult {
  const hits = (store.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs);
  if (hits.length >= limit) {
    store.set(key, hits);
    const oldestHit = hits[0] ?? now;
    return {
      limited: true,
      retryAfter: Math.max(1, Math.ceil((oldestHit + windowMs - now) / 1000)),
    };
  }

  hits.push(now);
  store.set(key, hits);
  boundMemoryStore(now);
  return { limited: false, retryAfter: 0 };
}

async function withOperationTimeout<T>(operation: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Redis rate-limit operation timed out")),
          REDIS_OPERATION_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function parseRedisResult(value: unknown): RateLimitResult {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error("Invalid Redis rate-limit response");
  }
  const limited = Number(value[0]);
  const retryAfter = Number(value[1]);
  if (!Number.isFinite(limited) || !Number.isFinite(retryAfter)) {
    throw new Error("Invalid Redis rate-limit values");
  }
  return {
    limited: limited === 1,
    retryAfter: limited === 1 ? Math.max(1, Math.ceil(retryAfter)) : 0,
  };
}

/**
 * Check a shared sliding-window limit. Redis is authoritative when healthy;
 * the bounded process-local store preserves protection during Redis failures.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const normalizedWindowMs = Math.max(1, Math.floor(windowMs));
  if (limit <= 0) {
    return { limited: true, retryAfter: Math.max(1, Math.ceil(normalizedWindowMs / 1000)) };
  }

  const normalizedLimit = Math.max(1, Math.floor(limit));
  const now = Date.now();
  try {
    const result = await withOperationTimeout(
      rateLimitRedis.eval(
        SLIDING_WINDOW_SCRIPT,
        1,
        key,
        now,
        normalizedWindowMs,
        normalizedLimit,
        `${now}:${randomUUID()}`
      )
    );
    return parseRedisResult(result);
  } catch {
    return checkMemoryRateLimit(key, normalizedLimit, normalizedWindowMs, now);
  }
}

/**
 * Existing synchronous session-validation limiter. Its API and half-open
 * window behavior remain unchanged for current callers.
 */
export function isRateLimited(
  key: string,
  limit = parseEnvInt(process.env.SESSION_VALIDATE_RATE_LIMIT, 300),
  windowMs = 60_000
): boolean {
  return checkMemoryRateLimit(key, limit, windowMs).limited;
}

/** Clears in-memory rate limit state between tests. */
export function resetRateLimitsForTests(): void {
  store.clear();
}
