import { Redis } from "ioredis";

declare global {
  var __redis: Redis | undefined;
  var __rateLimitRedis: Redis | undefined;
}

/**
 * Shared ioredis connection for the async AI-job queue (BullMQ). BullMQ requires
 * `maxRetriesPerRequest: null` on the connection it blocks on. Cached on
 * `globalThis` in dev so hot-reload doesn't leak a new connection per reload,
 * mirroring the pattern in `prisma.server.ts`.
 *
 * `lazyConnect` defers the TCP connect until the queue is first used, so the app
 * boots even when Redis isn't up yet (nothing wires this in until #914). The
 * `error` handler prevents an unhandled `error` event from crashing the process
 * when Redis is unreachable — ioredis emits `error` on every reconnect attempt.
 */
function getRedis(): Redis {
  const cached = globalThis.__redis;
  if (cached) {
    return cached;
  }

  const client = new Redis(process.env.REDIS_URL ?? "redis://localhost:63790", {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });
  client.on("error", (err) => {
    console.error("[redis] connection error:", err.message);
  });
  if (process.env.NODE_ENV !== "production") {
    globalThis.__redis = client;
  }
  return client;
}

const redis = getRedis();

/**
 * Rate-limit commands must fail quickly when Redis is unavailable. BullMQ's
 * shared client intentionally retries queued commands forever, so use a
 * duplicate with bounded per-command retries/timeouts instead of allowing an
 * HTTP request to inherit the queue worker's blocking connection semantics.
 */
function getRateLimitRedis(): Redis {
  const cached = globalThis.__rateLimitRedis;
  if (cached) {
    return cached;
  }

  const client = redis.duplicate({
    commandTimeout: 250,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  client.on("error", (err) => {
    console.error("[redis:rate-limit] connection error:", err.message);
  });
  if (process.env.NODE_ENV !== "production") {
    globalThis.__rateLimitRedis = client;
  }
  return client;
}

export const rateLimitRedis = getRateLimitRedis();

export default redis;
