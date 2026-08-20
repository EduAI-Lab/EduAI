import { randomUUID } from "node:crypto";
import { rateLimitRedis } from "~/lib/queue/connection.server";
import type { FleetLoadLease, JobType } from "./types";

type FleetLoadKey = {
  jobType: JobType;
  serverId: string;
  modelId: string;
};

type LoadEntry = {
  active: number;
  queued: number;
  ewmaLatencyMs: number | null;
};

const entries = new Map<string, LoadEntry>();
const EWMA_ALPHA = 0.25;
const DEFAULT_RESERVATION_TTL_MS = 15 * 60_000;

const SHARED_COUNT_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
redis.call("ZREMRANGEBYSCORE", key, "-inf", now)
return redis.call("ZCARD", key)
`;

const SHARED_RESERVE_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local expires = tonumber(ARGV[2])
local member = ARGV[3]
local ttl = tonumber(ARGV[4])
redis.call("ZREMRANGEBYSCORE", key, "-inf", now)
redis.call("ZADD", key, expires, member)
redis.call("PEXPIRE", key, ttl)
return redis.call("ZCARD", key)
`;

function keyFor(input: FleetLoadKey): string {
  return `${input.jobType}:${input.serverId}:${input.modelId.toLowerCase()}`;
}

function entryFor(key: string): LoadEntry {
  const existing = entries.get(key);
  if (existing) return existing;
  const created: LoadEntry = { active: 0, queued: 0, ewmaLatencyMs: null };
  entries.set(key, created);
  return created;
}

function sharedStateEnabled(): boolean {
  return process.env.FLEET_LOAD_SHARED_STATE !== "0" && Boolean(process.env.REDIS_URL?.trim());
}

function sharedKey(input: FleetLoadKey): string {
  return `eduai:fleet-load:${keyFor(input)}`;
}

function reservationTtlMs(): number {
  const parsed = Number(process.env.FLEET_LOAD_RESERVATION_TTL_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_RESERVATION_TTL_MS;
  return Math.max(30_000, Math.min(60 * 60_000, Math.floor(parsed)));
}

/** Reset process-local fleet load state between tests or controlled reloads. */
export function resetFleetLoad(): void {
  entries.clear();
}

/** Snapshot load for one server/model target. */
export function getFleetLoad(input: FleetLoadKey): LoadEntry {
  const value = entryFor(keyFor(input));
  return { ...value };
}

/**
 * Score a target for interactive selection. Waiting work is counted so a burst
 * of requests cannot all choose the same target before its first request starts.
 * A modest EWMA penalty makes a persistently slower target lose ties without
 * permanently ejecting it from the pool.
 */
export async function fleetLoadScore(input: FleetLoadKey): Promise<number> {
  const value = entryFor(keyFor(input));
  const latencyPenalty = value.ewmaLatencyMs === null
    ? 0
    : Math.min(4, value.ewmaLatencyMs / 1_000);
  const localScore = value.active + value.queued + latencyPenalty;
  if (!sharedStateEnabled()) return localScore;

  try {
    const sharedCount = await rateLimitRedis.eval(
      SHARED_COUNT_SCRIPT,
      1,
      sharedKey(input),
      Date.now(),
    );
    const count = Number(sharedCount);
    return Number.isFinite(count) ? count + latencyPenalty : localScore;
  } catch {
    return localScore;
  }
}

function recordLatency(key: string, durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  const value = entryFor(key);
  value.ewmaLatencyMs = value.ewmaLatencyMs === null
    ? durationMs
    : value.ewmaLatencyMs * (1 - EWMA_ALPHA) + durationMs * EWMA_ALPHA;
}

/**
 * Reserve a target before global admission. The reservation is visible to the
 * next picker even while the request is waiting in Core's FIFO queue.
 */
export async function reserveFleetLoad(input: FleetLoadKey): Promise<FleetLoadLease> {
  const key = keyFor(input);
  const value = entryFor(key);
  value.queued += 1;

  const sharedReservationKey = sharedKey(input);
  const sharedMember = randomUUID();
  let sharedReserved = false;
  if (sharedStateEnabled()) {
    try {
      const ttl = reservationTtlMs();
      await rateLimitRedis.eval(
        SHARED_RESERVE_SCRIPT,
        1,
        sharedReservationKey,
        Date.now(),
        Date.now() + ttl,
        sharedMember,
        ttl,
      );
      sharedReserved = true;
    } catch {
      // Redis is an optimization for cross-process visibility. The local
      // reservation still protects this Core process when Redis is unavailable.
    }
  }

  let state: "queued" | "active" | "released" = "queued";
  let startedAt = 0;

  return {
    markActive() {
      if (state !== "queued") return;
      value.queued = Math.max(0, value.queued - 1);
      value.active += 1;
      startedAt = Date.now();
      state = "active";
    },
    release() {
      if (state === "released") return;
      if (state === "active") {
        value.active = Math.max(0, value.active - 1);
        recordLatency(key, Date.now() - startedAt);
      } else {
        value.queued = Math.max(0, value.queued - 1);
      }
      state = "released";
      if (sharedReserved) {
        void rateLimitRedis.zrem(sharedReservationKey, sharedMember).catch(() => {});
      }
    },
  };
}
