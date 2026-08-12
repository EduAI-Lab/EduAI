import { QUEUE_CHAT, type QueueName } from "./resolve-pool.server";

function parseConcurrency(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Effective worker concurrency used as the pool's service-rate multiplier. */
export function workerConcurrency(queueName: QueueName): number {
  return queueName === QUEUE_CHAT
    ? parseConcurrency(process.env.AI_JOB_CHAT_CONCURRENCY, 8)
    : parseConcurrency(process.env.AI_JOB_HEAVY_CONCURRENCY, 1);
}
