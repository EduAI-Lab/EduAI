import { Redis } from "ioredis";

declare global {
  var __redis: Redis | undefined;
}

/**
 * Shared ioredis connection for the async AI-job queue (BullMQ). BullMQ requires
 * `maxRetriesPerRequest: null` on the connection it blocks on. Cached on
 * `globalThis` in dev so hot-reload doesn't leak a new connection per reload,
 * mirroring the pattern in `prisma.server.ts`.
 */
function getRedis(): Redis {
  const cached = globalThis.__redis;
  if (cached) {
    return cached;
  }

  const client = new Redis(process.env.REDIS_URL ?? "redis://localhost:63790", {
    maxRetriesPerRequest: null,
  });
  if (process.env.NODE_ENV !== "production") {
    globalThis.__redis = client;
  }
  return client;
}

const redis = getRedis();

export default redis;
