import type { JobType } from "./job-schema";

/**
 * Pool + priority resolver for the AI-job queue.
 *
 * TEMPORARY SHIM. The frozen contract (§2/§4/§6) routes jobs via the fleet layer
 * (`app/lib/ai/routing/fleet/types.ts` — `featureToJobType`, `resolveFleetHost`),
 * which does not exist in code yet. This encodes the v1 reality directly:
 *   - The heavy pool (cmps03 / `VLLM_FLEET_HEAVY_URL`) is not running, so
 *     `background` resolves to the chat pool too — both types land on `ai-jobs:chat`.
 *   - Priority (from `type`) keeps interactive draining ahead of background while a
 *     single pool serves both.
 *
 * TODO(#168): replace with the fleet's `resolveFleetHost()` pool logic once
 * `fleet/types.ts` lands. When cmps03 is configured, `background` re-resolves to
 * `ai-jobs:heavy` with no schema or contract change.
 */

export const QUEUE_CHAT = "ai-jobs:chat" as const;
export const QUEUE_HEAVY = "ai-jobs:heavy" as const;

export type QueueName = typeof QUEUE_CHAT | typeof QUEUE_HEAVY;

// BullMQ priority: lower number drains first (contract §4).
export const PRIORITY_INTERACTIVE = 1;
export const PRIORITY_BACKGROUND = 10;

function heavyPoolConfigured(): boolean {
  return Boolean(process.env.VLLM_FLEET_HEAVY_URL?.trim());
}

/**
 * Resolve the target queue from the fleet pool for `type`. `background` only
 * reaches `ai-jobs:heavy` once the heavy pool is configured; otherwise it shares
 * the chat pool and relies on priority to yield to interactive work.
 */
export function resolveQueueName(type: JobType): QueueName {
  if (type === "background" && heavyPoolConfigured()) {
    return QUEUE_HEAVY;
  }
  return QUEUE_CHAT;
}

/** Priority derived from `type` — the single source, never a stored field (contract §3). */
export function priorityFor(type: JobType): number {
  return type === "interactive" ? PRIORITY_INTERACTIVE : PRIORITY_BACKGROUND;
}
