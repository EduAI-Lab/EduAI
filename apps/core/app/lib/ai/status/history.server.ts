/**
 * Bucketing persisted samples into the 72-hour status panel payload.
 *
 * Thresholds are applied to each raw sample BEFORE bucketing, so `degraded`
 * exists here even though it is never stored (see status-probe.server.ts).
 *
 * ~1,700 rows for a 72h window across six models, so this buckets in JS rather
 * than in SQL: nothing Postgres-specific, and the logic is unit-testable with
 * no database.
 */
import { resolveLoadThresholds } from "~/lib/ai/service-status.server";
import { MAX_WINDOW_HOURS, retentionDays } from "~/lib/ai/status/config.server";
import { resolveStatusHosts } from "~/lib/ai/status/hosts.server";
import { deriveRowState, type DerivedState, type LatestSample } from "~/lib/ai/status/read.server";
import { modelDisplayLabel, modelKey, serverDisplayLabel, serverKey } from "~/lib/ai/status/labels";
import prisma from "~/lib/prisma.server";

export interface HistoryBucket {
  t: string;
  state: DerivedState | null;
}

export interface HistoryModel {
  key: string;
  label: string;
  /**
   * Percentage of JUDGEABLE buckets that were up. Null when none were: with
   * nothing to divide by, any number would be an invention, and 0 in
   * particular would report a configuration fault as total downtime.
   */
  uptimePct: number | null;
  buckets: HistoryBucket[];
}

export interface HistoryServer {
  key: string;
  label: string;
  waiting: number | null;
  cacheUsage: number | null;
  models: HistoryModel[];
}

export interface HistoryPayload {
  windowHours: number;
  bucketMinutes: number;
  generatedAt: string;
  servers: HistoryServer[];
}

const SEVERITY = {
  operational: 0,
  degraded: 1,
  unknown: 2,
  outage: 3,
} satisfies Record<DerivedState, number>;

const UP_STATES: ReadonlySet<DerivedState> = new Set<DerivedState>(["operational", "degraded"]);

export function bucketSamples(
  samples: LatestSample[],
  opts: {
    windowHours: number;
    now: Date;
    thresholds: { waiting: number; cachePct: number };
    liveServerIds: string[];
  },
): HistoryPayload {
  const { windowHours, now, thresholds, liveServerIds } = opts;

  // A cadence slower than an hour would render a comb of false gaps at hourly
  // width, so the bucket widens to match the interval actually in force.
  const interval = samples.length > 0 ? Math.max(...samples.map((s) => s.intervalMinutes)) : 60;
  const bucketMinutes = Math.max(60, interval);
  const bucketMs = bucketMinutes * 60 * 1000;
  const bucketCount = Math.max(1, Math.ceil((windowHours * 60) / bucketMinutes));
  const endMs = Math.ceil(now.getTime() / bucketMs) * bucketMs;
  const startMs = endMs - bucketCount * bucketMs;

  const allIds = [...new Set([...liveServerIds, ...samples.map((s) => s.serverId)])];

  // serverId -> modelId -> bucketIndex -> worst derived state
  const grid = new Map<string, Map<string, Array<DerivedState | null>>>();
  const hostLoad = new Map<
    string,
    { waiting: number | null; cacheUsage: number | null; at: number }
  >();

  for (const sample of samples) {
    const at = sample.observedAt.getTime();
    if (at < startMs || at > endMs) continue;

    // A sample observed exactly at `now` sits ON the exclusive upper edge of
    // the bucket grid; clamp it into the final bucket rather than dropping it.
    const index = Math.min(bucketCount - 1, Math.floor((at - startMs) / bucketMs));
    const state = deriveRowState(sample, thresholds);

    let byModel = grid.get(sample.serverId);
    if (!byModel) {
      byModel = new Map();
      grid.set(sample.serverId, byModel);
    }
    let buckets = byModel.get(sample.modelId);
    if (!buckets) {
      buckets = Array.from<DerivedState | null>({ length: bucketCount }).fill(null);
      byModel.set(sample.modelId, buckets);
    }

    const current = buckets[index];
    if (current === null || SEVERITY[state] > SEVERITY[current]) {
      buckets[index] = state;
    }

    const known = hostLoad.get(sample.serverId);
    if (!known || at > known.at) {
      hostLoad.set(sample.serverId, {
        waiting: sample.waiting,
        cacheUsage: sample.cacheUsage,
        at,
      });
    }
  }

  const servers: HistoryServer[] = [...grid.entries()]
    .map(([serverId, byModel]) => {
      const load = hostLoad.get(serverId);
      const models: HistoryModel[] = [...byModel.entries()]
        .map(([modelId, buckets]) => {
          // `unknown` means "we could not tell" — a missing key, a malformed
          // config, a probe that threw. Counting it against uptime reported a
          // configuration fault to the user as downtime, so it is excluded
          // from the denominator rather than treated as a failed hour.
          const judged = buckets.filter((b): b is DerivedState => b !== null && b !== "unknown");
          const up = judged.filter((b) => UP_STATES.has(b)).length;
          return {
            key: modelKey(modelId, serverId, allIds),
            label: modelDisplayLabel(modelId, serverId, allIds),
            uptimePct: judged.length === 0 ? null : (up / judged.length) * 100,
            buckets: buckets.map((state, i) => ({
              t: new Date(startMs + i * bucketMs).toISOString(),
              state,
            })),
          };
        })
        .sort((a, b) => a.label.localeCompare(b.label));

      return {
        key: serverKey(serverId, allIds),
        label: serverDisplayLabel(serverId, allIds),
        waiting: load?.waiting ?? null,
        cacheUsage: load?.cacheUsage ?? null,
        models,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  return {
    windowHours,
    bucketMinutes,
    generatedAt: now.toISOString(),
    servers,
  };
}

/** The window served when the caller asks for nothing, or for nonsense. */
export const DEFAULT_WINDOW_HOURS = 72;

/**
 * Read the persisted samples for one window and bucket them for the UI.
 *
 * Shared by `GET /api/ai-status/history` and Core's `/status` page loader, so
 * the two can never disagree about the clamp or about which hosts count as
 * live. Callers own their own auth; this function only reads.
 */
export async function loadHistoryPayload({
  hours,
  now = new Date(),
}: {
  hours?: number;
  now?: Date;
}): Promise<HistoryPayload> {
  // `Number(undefined)` is NaN, so the finite check alone rejects both a
  // missing window and a caller's garbage `?hours=` value.
  const requested = Number(hours);
  const asked = Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_WINDOW_HOURS;
  // Clamp to the retention actually in force, and report what was applied,
  // so a short retention reads as configuration rather than as downtime.
  const windowHours = Math.min(asked, MAX_WINDOW_HOURS, retentionDays() * 24);

  const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  const samples = await prisma.aiServiceSample.findMany({
    where: { observedAt: { gte: since } },
    orderBy: { observedAt: "asc" },
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

  return bucketSamples(samples, {
    windowHours,
    now,
    thresholds: resolveLoadThresholds(),
    liveServerIds: resolveStatusHosts().map((h) => h.serverId),
  });
}
