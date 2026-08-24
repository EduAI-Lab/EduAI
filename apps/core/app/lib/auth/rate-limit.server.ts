import type { JsonValue } from "~/lib/json-value";
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

// Bound the process-local fallback (#990). The stale window (1 hour) is
// larger than the ~60s burst limiter. The local-chatbot daily cap (#1547)
// reuses this store with a 24-hour window: if Redis is down and the store
// exceeds MAX_STORE_KEYS, a chat-daily:* key idle between 1h and 24h can
// be evicted, which resets that user's count. That fails open (more
// messages, not fewer). Redis stays authoritative when it is healthy.
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
  now = Date.now(),
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
          REDIS_OPERATION_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/**
 * The reply of the rate-limit Lua script: `[limited, retryAfter]`. Typed as
 * JSON rather than `unknown` because a Redis reply is scalars and arrays, and
 * this is the shape the script is written to return.
 */
function parseRedisResult(value: JsonValue | undefined): RateLimitResult {
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
  windowMs: number,
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
        `${now}:${randomUUID()}`,
      ),
    );
    // SAFETY: a Redis reply is scalars and arrays — exactly what `JsonValue`
    // covers — and the shape is checked field by field inside.
    return parseRedisResult(result as JsonValue);
  } catch {
    return checkMemoryRateLimit(key, normalizedLimit, normalizedWindowMs, now);
  }
}

/**
 * Undo the most recent `checkRateLimit` charge for a key (#1547 Bedrock
 * overflow interaction). Used when a reservation was taken against one
 * quota (e.g. the local daily cap) but the turn actually executed
 * elsewhere, so it should not count. Best-effort: it removes the
 * highest-scored member, which is almost always the charge just made by
 * this same request. A concurrent charge from another request landing in
 * between would be refunded instead — rare, and fails open (one extra
 * message), not closed.
 */
export async function refundMostRecentRateLimitCharge(key: string): Promise<void> {
  try {
    await withOperationTimeout(
      rateLimitRedis.eval(
        `local key = KEYS[1]
         local top = redis.call("ZRANGE", key, -1, -1)
         if top[1] then redis.call("ZREM", key, top[1]) end
         return 0`,
        1,
        key,
      ),
    );
  } catch {
    const hits = store.get(key);
    if (hits && hits.length > 0) {
      hits.pop();
      store.set(key, hits);
    }
  }
}

/**
 * Existing synchronous session-validation limiter. Its API and half-open
 * window behavior remain unchanged for current callers.
 */
export function isRateLimited(
  key: string,
  limit = parseEnvInt(process.env.SESSION_VALIDATE_RATE_LIMIT, 300),
  windowMs = 60_000,
): boolean {
  return checkMemoryRateLimit(key, limit, windowMs).limited;
}

/** Clears in-memory rate limit state between tests. */
export function resetRateLimitsForTests(): void {
  store.clear();
}
