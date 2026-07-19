import { Queue, type ConnectionOptions } from "bullmq";
import redis from "./connection.server";
import { QUEUE_CHAT, QUEUE_HEAVY, type QueueName } from "./resolve-pool.server";

/**
 * BullMQ queues for the async AI-job pipeline — one queue per fleet pool
 * (contract §4). Both share the single hot-reload-safe ioredis connection from
 * `connection.server.ts` (`maxRetriesPerRequest: null`, required by BullMQ).
 *
 * Cached on `globalThis` in dev so hot-reload doesn't leak a new Queue (and its
 * own Redis duplicate) per reload, mirroring `prisma.server.ts` / `connection.server.ts`.
 */

declare global {
  var __aiJobQueues: Map<QueueName, Queue> | undefined;
}

function getRegistry(): Map<QueueName, Queue> {
  const cached = globalThis.__aiJobQueues;
  if (cached) {
    return cached;
  }
  const registry = new Map<QueueName, Queue>();
  if (process.env.NODE_ENV !== "production") {
    globalThis.__aiJobQueues = registry;
  }
  return registry;
}

export function getQueue(name: QueueName): Queue {
  const registry = getRegistry();
  let queue = registry.get(name);
  if (!queue) {
    // The shared ioredis instance works at runtime, but BullMQ's `connection`
    // type (`ConnectionOptions`) doesn't accept a bare `Redis` instance resolved
    // through the app's own ioredis — a known BullMQ/ioredis type clash. Cast to
    // reuse the singleton from connection.server.ts (contract §4) without dropping it.
    queue = new Queue(name, { connection: redis as unknown as ConnectionOptions });
    registry.set(name, queue);
  }
  return queue;
}

export const AI_JOB_QUEUE_NAMES: QueueName[] = [QUEUE_CHAT, QUEUE_HEAVY];
