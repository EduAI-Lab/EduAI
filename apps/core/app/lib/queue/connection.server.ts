import { Redis } from "ioredis";

declare global {
  var __redis: Redis | undefined;
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

export default redis;
