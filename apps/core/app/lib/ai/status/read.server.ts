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
import { resolveStatusHosts } from "~/lib/ai/status/hosts.server";
import prisma from "~/lib/prisma.server";

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

  // A decommissioned host's final OUTAGE row would otherwise hold the chip amber
  // for the whole retention window.
  return prisma.aiServiceSample.findMany({
    where: { serverId: { in: liveIds } },
    distinct: ["serverId", "modelId"],
    orderBy: { observedAt: "desc" },
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

export async function getUbcStatusFromSamples(): Promise<{
  status: ServiceStatus;
  checkedAt: string | null;
  stale: boolean;
}> {
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
