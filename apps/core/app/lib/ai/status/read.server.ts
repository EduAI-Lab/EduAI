/**
 * Reading persisted AI status (#764 follow-on).
 *
 * Nothing threshold-derived is stored, so BOTH the fleet-wide chip verdict and
 * the per-row panel verdict are computed here from the same raw waiting/
 * cacheUsage and the same resolveLoadThresholds(). That is what stops the panel
 * contradicting the chip: aggregateUbcStatus degrades on the SUM of waiting
 * across hosts and the MAX cacheUsage, while a row degrades on its own host's
 * numbers — two different questions, one set of thresholds.
 */
import {
  aggregateUbcStatus,
  resolveLoadThresholds,
  type HostProbe,
  type ServiceStatus,
} from "~/lib/ai/service-status.server";
import { retentionDays } from "~/lib/ai/status/config.server";
import { resolveStatusHosts } from "~/lib/ai/status/hosts.server";
import prisma from "~/lib/prisma.server";

/**
 * Upper bound on the rows fetched for "newest per (serverId, modelId)".
 *
 * Prisma applies `distinct` after fetching, so an unbounded `findMany` over a
 * whole retention window reads every sample in the table to keep a handful.
 * Ordered newest-first, the current tick's rows come first, so a few hundred
 * rows covers many ticks' worth of every host × model pair.
 */
const LATEST_SAMPLE_SCAN_LIMIT = 500;

export interface LatestSample {
  serverId: string;
  modelId: string;
  state: string;
  reachable: boolean;
  waiting: number | null;
  cacheUsage: number | null;
  intervalMinutes: number;
  observedAt: Date;
}

export type DerivedState = "operational" | "degraded" | "outage" | "unknown";

/** A sample is stale once it is older than three of its own poll intervals. */
export function isStale(
  newestObservedAt: Date | null,
  intervalMinutes: number,
  now: Date = new Date(),
): boolean {
  if (!newestObservedAt) return true;
  const horizonMs = intervalMinutes * 3 * 60 * 1000;
  return now.getTime() - newestObservedAt.getTime() > horizonMs;
}

export function deriveRowState(
  sample: LatestSample,
  thresholds: { waiting: number; cachePct: number },
): DerivedState {
  if (sample.state === "UNKNOWN") return "unknown";
  if (sample.state === "OUTAGE" || !sample.reachable) return "outage";

  // Load unknown (either column null) cannot degrade a reachable host.
  if (sample.waiting == null || sample.cacheUsage == null) return "operational";
  if (sample.waiting > thresholds.waiting || sample.cacheUsage > thresholds.cachePct) {
    return "degraded";
  }
  return "operational";
}

/** Newest sample per (serverId, modelId), restricted to hosts that still exist. */
export async function loadLatestSamples(): Promise<LatestSample[]> {
  const liveIds = resolveStatusHosts().map((host) => host.serverId);
  if (liveIds.length === 0) return [];

  // Nothing older than retention exists (the probe prunes it), so this bound
  // changes no answer — it just stops the query planner reading the whole
  // table when pruning is behind or retention is long.
  const since = new Date(Date.now() - retentionDays() * 24 * 60 * 60 * 1000);

  // A decommissioned host's final OUTAGE row would otherwise hold the chip amber
  // for the whole retention window.
  return prisma.aiServiceSample.findMany({
    where: { serverId: { in: liveIds }, observedAt: { gte: since } },
    distinct: ["serverId", "modelId"],
    orderBy: { observedAt: "desc" },
    take: LATEST_SAMPLE_SCAN_LIMIT,
    select: {
      serverId: true,
      modelId: true,
      state: true,
      reachable: true,
      waiting: true,
      cacheUsage: true,
      intervalMinutes: true,
      observedAt: true,
    },
  });
}

/**
 * Fold model rows into one HostProbe per host for the fleet-wide verdict. Pure
 * and DB-independent: a host counts as reachable if ANY of its model rows is,
 * and a load value carries forward across the collapse (a row with unknown
 * load does not blank out a load already seen from another row on that host).
 */
export function collapseToHostProbes(samples: LatestSample[]): HostProbe[] {
  const byHost = new Map<string, HostProbe>();
  for (const sample of samples) {
    const existing = byHost.get(sample.serverId);
    const reachable = sample.reachable || (existing?.reachable ?? false);
    const load =
      sample.waiting != null && sample.cacheUsage != null
        ? { waiting: sample.waiting, cacheUsage: sample.cacheUsage }
        : (existing?.load ?? null);
    byHost.set(sample.serverId, { reachable, load });
  }
  return [...byHost.values()];
}

export interface UbcStatusRead {
  status: ServiceStatus;
  checkedAt: string | null;
  stale: boolean;
}

export async function getUbcStatusFromSamples(): Promise<UbcStatusRead> {
  const samples = await loadLatestSamples();

  if (samples.length === 0) {
    return {
      status: { state: "unknown", detail: "No status data yet." },
      checkedAt: null,
      stale: true,
    };
  }

  const newestSample = samples.reduce((acc, s) => (s.observedAt > acc.observedAt ? s : acc));
  const newest = newestSample.observedAt;
  const intervalMinutes = newestSample.intervalMinutes;
  const stale = isStale(newest, intervalMinutes);
  const checkedAt = newest.toISOString();

  if (stale) {
    const minutes = Math.round((Date.now() - newest.getTime()) / 60000);
    return {
      status: {
        state: "unknown",
        detail: `Status data is stale — last checked ${minutes} minutes ago.`,
      },
      checkedAt,
      stale: true,
    };
  }

  return {
    status: aggregateUbcStatus(collapseToHostProbes(samples), resolveLoadThresholds()),
    checkedAt,
    stale: false,
  };
}

/**
 * Header polls collapse onto one read (#764 follow-on review).
 *
 * Every signed-in tab in all three apps polls `/api/ai-status`, but the
 * underlying sample only changes when the cron probe runs (~15 min), so each
 * poll re-ran the same query. A short module-level cache plus single-flight
 * means a burst of tabs costs one query, and the value can never be staler than
 * a minute — far fresher than its source. Deliberately not per-user: the fleet
 * verdict is identical for everyone and carries no user data.
 */
const STATUS_CACHE_TTL_MS = 60_000;

let cachedStatus: { at: number; value: UbcStatusRead } | null = null;
let inFlightStatus: Promise<UbcStatusRead> | null = null;

export async function getUbcStatusCached(): Promise<UbcStatusRead> {
  if (cachedStatus && Date.now() - cachedStatus.at < STATUS_CACHE_TTL_MS) {
    return cachedStatus.value;
  }
  // A second caller arriving mid-read joins the first one rather than issuing
  // its own query; a failed read caches nothing, so the next call retries.
  inFlightStatus ??= getUbcStatusFromSamples()
    .then((value) => {
      cachedStatus = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inFlightStatus = null;
    });
  return inFlightStatus;
}

/** Drops the cached read. For tests, and for any caller that just wrote samples. */
export function clearUbcStatusCache(): void {
  cachedStatus = null;
  inFlightStatus = null;
}
