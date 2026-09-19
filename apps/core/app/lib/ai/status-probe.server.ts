/**
 * The `ai-status-probe` CORE cron handler (#764 follow-on).
 *
 * Runs ONLY in `eduai-cron-worker` — see docs/CRON_JOBS.md. Two HTTP GETs per
 * host (/v1/models and /metrics): no inference, no admission slot, no tokens.
 *
 * Stored `state` is reachability only. DEGRADED is never written; it is derived
 * at read time from raw waiting/cacheUsage so one code path owns the thresholds
 * and a later retune can be re-applied to existing history.
 */
import { getServerHealth } from "~/lib/ai/routing/fleet/health";
import { probeVllmLoad } from "~/lib/ai/service-status/vllm-metrics.server";
import { pollMinutes, retentionDays } from "~/lib/ai/status/config.server";
import { resolveStatusHosts, type StatusHost } from "~/lib/ai/status/hosts.server";
import prisma from "~/lib/prisma.server";

type SampleState = "OPERATIONAL" | "OUTAGE" | "UNKNOWN";

/**
 * Namespaced sentinel model id used only when a host is unreachable and we
 * have neither observation history nor configured models for it. Kept
 * distinct from real vendor model ids so it can never collide with one.
 */
export const UNKNOWN_MODEL_SENTINEL = "__unknown__";

interface SampleRow {
  serverId: string;
  modelId: string;
  state: SampleState;
  reachable: boolean;
  waiting: number | null;
  cacheUsage: number | null;
  intervalMinutes: number;
  detail: string | null;
}

/**
 * A missing key or malformed config is not an outage — we could not tell. The
 * distinction matters because this history is meant to stay truthful when
 * re-read months later.
 */
export function isConfigurationFault(error: string | undefined): boolean {
  if (!error) return false;
  return /not configured|missing.*key/i.test(error);
}

/** Models to record for a host we could not reach: last observed, else configured. */
async function modelsForUnreachableHost(host: StatusHost): Promise<string[]> {
  const previous = await prisma.aiServiceSample.findMany({
    where: { serverId: host.serverId },
    distinct: ["modelId"],
    orderBy: { observedAt: "desc" },
    select: { serverId: true, modelId: true },
    take: 50,
  });
  const realModelIds = previous
    .map((row) => row.modelId)
    .filter((modelId) => modelId !== UNKNOWN_MODEL_SENTINEL);
  if (realModelIds.length > 0) return realModelIds;
  if (host.configuredModels.length > 0) return host.configuredModels;
  // Nothing real is known for this host — neither history nor config — so
  // record the host as down rather than letting it vanish from the chart
  // with zero rows. The sentinel is never mixed with real model ids.
  return [UNKNOWN_MODEL_SENTINEL];
}

async function sampleHost(host: StatusHost, intervalMinutes: number): Promise<SampleRow[]> {
  let health: Awaited<ReturnType<typeof getServerHealth>>;
  let load: Awaited<ReturnType<typeof probeVllmLoad>> = null;

  try {
    [health, load] = await Promise.all([
      getServerHealth(host.baseUrl),
      probeVllmLoad(host.baseUrl),
    ]);
  } catch (error) {
    // An unexpected throw is "we could not tell", not "it is down".
    const models = await modelsForUnreachableHost(host);
    return models.map((modelId) => ({
      serverId: host.serverId,
      modelId,
      state: "UNKNOWN" as const,
      reachable: false,
      waiting: null,
      cacheUsage: null,
      intervalMinutes,
      detail: error instanceof Error ? error.message.slice(0, 200) : "probe threw",
    }));
  }

  // waiting/cacheUsage are written as a pair so "load unknown" is unambiguous.
  const waiting = load ? load.waiting : null;
  const cacheUsage = load ? load.cacheUsage : null;

  if (health.ok) {
    const models = health.modelIds ?? [];
    return models.map((modelId) => ({
      serverId: host.serverId,
      modelId,
      state: "OPERATIONAL" as const,
      reachable: true,
      waiting,
      cacheUsage,
      intervalMinutes,
      detail: null,
    }));
  }

  const state: SampleState = isConfigurationFault(health.error) ? "UNKNOWN" : "OUTAGE";
  const models = await modelsForUnreachableHost(host);
  return models.map((modelId) => ({
    serverId: host.serverId,
    modelId,
    state,
    reachable: false,
    waiting: null,
    cacheUsage: null,
    intervalMinutes,
    detail: health.error?.slice(0, 200) ?? null,
  }));
}

export async function runAiStatusProbe(): Promise<{ message: string }> {
  const hosts = resolveStatusHosts();
  if (hosts.length === 0) {
    return { message: "No UBC-hosted inference configured; nothing sampled" };
  }

  const intervalMinutes = pollMinutes();
  const settled = await Promise.allSettled(hosts.map((host) => sampleHost(host, intervalMinutes)));

  const rows: SampleRow[] = [];
  for (const outcome of settled) {
    if (outcome.status === "fulfilled") rows.push(...outcome.value);
  }

  if (rows.length > 0) {
    await prisma.aiServiceSample.createMany({ data: rows });
  }

  const cutoff = new Date(Date.now() - retentionDays() * 24 * 60 * 60 * 1000);
  const pruned = await prisma.aiServiceSample.deleteMany({
    where: { observedAt: { lt: cutoff } },
  });

  const up = rows.filter((r) => r.state === "OPERATIONAL").length;
  const outage = rows.filter((r) => r.state === "OUTAGE").length;
  const unknown = rows.filter((r) => r.state === "UNKNOWN").length;

  return {
    message: `${hosts.length} hosts, ${rows.length} models: ${up} up, ${outage} outage, ${unknown} unknown; pruned ${pruned.count}`,
  };
}
