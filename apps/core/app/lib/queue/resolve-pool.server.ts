import { heavyFleetConfigured } from "~/lib/ai/routing/fleet/registry";
import type { JobType } from "./job-schema";

/**
 * Pool + priority resolver for the AI-job queue.
 *
 * The frozen contract (§2/§4/§6) keys queues by the fleet pool. This resolver
 * mirrors the fleet registry's v1 pool selection without probing host health:
 *   - The heavy pool (e.g. cmps03) is not running, so `background` resolves
 *     to the chat pool too — both types land on `ai-jobs-chat`.
 *   - Priority (from `type`) keeps interactive draining ahead of background while a
 *     single pool serves both.
 *
 * `heavyFleetConfigured()` (fleet/registry.ts) is the single source of truth
 * for "is there a background-capable server" — it checks fleet.config.json
 * first and only falls back to `VLLM_FLEET_HEAVY_URL` when no config file is
 * present, same as every other fleet pool-selection decision. Previously this
 * resolver checked `VLLM_FLEET_HEAVY_URL` directly, so a background server
 * added only via fleet.config.json (no env var set) was never routed to
 * `ai-jobs-heavy` — resolveQueueName and the fleet registry disagreed about
 * which servers exist.
 *
 * The dequeue worker performs the live `resolveFleetHost()` selection before
 * inference. When a heavy/background server is configured, `background`
 * resolves to `ai-jobs-heavy` with no schema or contract change.
 */

// BullMQ forbids ":" in queue names. Hyphens preserve the pool-qualified names.
export const QUEUE_CHAT = "ai-jobs-chat" as const;
export const QUEUE_HEAVY = "ai-jobs-heavy" as const;

export type QueueName = typeof QUEUE_CHAT | typeof QUEUE_HEAVY;

// BullMQ priority: lower number drains first (contract §4).
export const PRIORITY_INTERACTIVE = 1;
export const PRIORITY_BACKGROUND = 10;

/**
 * Resolve the target queue from the fleet pool for `type`. `background` only
 * reaches `ai-jobs-heavy` once the heavy pool is configured; otherwise it shares
 * the chat pool and relies on priority to yield to interactive work.
 */
export function resolveQueueName(type: JobType): QueueName {
  if (type === "background" && heavyFleetConfigured()) {
    return QUEUE_HEAVY;
  }
  return QUEUE_CHAT;
}

/** Priority derived from `type` — the single source, never a stored field (contract §3). */
export function priorityFor(type: JobType): number {
  return type === "interactive" ? PRIORITY_INTERACTIVE : PRIORITY_BACKGROUND;
}
