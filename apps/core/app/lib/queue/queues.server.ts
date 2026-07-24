import { Queue, type ConnectionOptions } from "bullmq";
import redis from "./connection.server";
import { QUEUE_CHAT, QUEUE_HEAVY, type QueueName } from "./resolve-pool.server";

/**
 * BullMQ queues for the async AI-job pipeline — one queue per fleet pool
 * (contract §4). Both share the single hot-reload-safe ioredis connection from
 * `connection.server.ts` (`maxRetriesPerRequest: null`, required by BullMQ).
 *
 * The registry is a process-wide singleton (all environments) so a Queue — and
 * its BullMQ script/handler registration — is built once per pool; `globalThis`
 * additionally carries it across dev hot-reloads.
 */

declare global {
  var __aiJobQueues: Map<QueueName, Queue> | undefined;
}

// Module-level singleton, also parked on `globalThis` so a dev hot-reload reuses
// it instead of leaking a Queue per reload. Unlike `prisma.server.ts` this must
// stay a single instance in production too: every `new Queue` re-registers
// BullMQ's Lua scripts and event handlers on the shared connection.
const registry: Map<QueueName, Queue> = (globalThis.__aiJobQueues ??= new Map<QueueName, Queue>());

export function getQueue(name: QueueName): Queue {
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
