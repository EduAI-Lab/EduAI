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
import { ollamaTagsUrl } from "~/lib/ai/ollama-url.server";
import { getServerHealth } from "~/lib/ai/routing/fleet/health";
import { probeVllmLoad, type VllmLoad } from "~/lib/ai/service-status/vllm-metrics.server";
import { minutesFromCron, pollMinutes, retentionDays } from "~/lib/ai/status/config.server";
import { resolveStatusHosts, type StatusHost } from "~/lib/ai/status/hosts.server";
import { asJsonArray, asJsonObject, asText, type JsonValue } from "~/lib/json-value";
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

/**
 * What a reachability probe answers, whichever API the host speaks. Mirrors the
 * fields of the fleet's `FleetHealthResult` that this module actually reads.
 */
interface HostHealth {
  ok: boolean;
  modelIds: string[] | null;
  error?: string;
}

/** How long an Ollama `/api/tags` probe may take before it counts as unreachable. */
const OLLAMA_PROBE_TIMEOUT_MS = 5_000;

/**
 * Reachability for an Ollama host.
 *
 * `getServerHealth` cannot answer this one. It is the vLLM fleet's check: it
 * requires `VLLM_API_KEY` and sends a bearer token to `/v1/models`. On an
 * Ollama-only deployment that key is legitimately absent, so the check returns
 * "VLLM_API_KEY not configured" — which `isConfigurationFault` then reads as a
 * configuration fault, writing UNKNOWN for a host that answers perfectly well,
 * on every tick, forever. Ollama needs no key and lists what it serves at
 * `/api/tags`, which is the endpoint the legacy `probeUbcStatus` polled before
 * this history existed; probing it here restores that signal.
 */
async function probeOllamaHost(baseUrl: string): Promise<HostHealth> {
  try {
    const res = await fetch(ollamaTagsUrl(baseUrl), {
      signal: AbortSignal.timeout(OLLAMA_PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, modelIds: null, error: `HTTP ${res.status}` };

    // SAFETY: `Response#json` resolves to whatever the host sent; naming it
    // `JsonValue` claims only what JSON parsing already guarantees.
    const body = (await res.json()) as JsonValue;
    const entries = asJsonArray(asJsonObject(body)?.models);
    // A 200 whose shape we cannot read is not a reachable fleet member, the
    // same call `getServerHealth` makes on an unparseable /v1/models.
    if (!entries) return { ok: false, modelIds: null, error: "invalid /api/tags response" };

    const modelIds: string[] = [];
    for (const entry of entries) {
      const record = asJsonObject(entry);
      const id = asText(record?.name) ?? asText(record?.model);
      if (id !== null) modelIds.push(id);
    }
    return { ok: true, modelIds };
  } catch (error) {
    return {
      ok: false,
      modelIds: null,
      error: error instanceof Error ? error.message : "ollama probe failed",
    };
  }
}

/**
 * Probe one host with the check its API actually supports, and collect load
 * where there is any to collect. Ollama exposes no vLLM `/metrics`, so its load
 * stays null — "load unknown", which is what the legacy probe recorded for it
 * too, and which `deriveRowState` already refuses to let degrade a host.
 */
async function probeHost(host: StatusHost): Promise<{ health: HostHealth; load: VllmLoad | null }> {
  if (host.kind === "ollama") {
    return { health: await probeOllamaHost(host.baseUrl), load: null };
  }
  const [health, load] = await Promise.all([
    getServerHealth(host.baseUrl),
    probeVllmLoad(host.baseUrl),
  ]);
  return { health, load };
}

/**
 * Last-known model ids for a host that is currently down.
 *
 * While a host stays unreachable this answer cannot change: the only rows being
 * written for it are the unreachable ones this lookup already filters out. So
 * re-running the query on every tick asks the database a question it has
 * already answered — indefinitely, for a decommissioned host still sitting in
 * config. The entry is dropped the moment the host answers again, so a host
 * that comes back serving something different is never handed a stale list.
 */
const lastKnownModelsWhileDown = new Map<string, string[]>();

/** Forget a host's cached down-state models once it is reachable again. */
function forgetDownHostModels(serverId: string): void {
  lastKnownModelsWhileDown.delete(serverId);
}

/** Drops the per-host caches this module keeps. For tests. */
export function resetStatusProbeCaches(): void {
  lastKnownModelsWhileDown.clear();
}

/** Models to record for a host we could not reach: last observed, else configured. */
async function modelsForUnreachableHost(host: StatusHost): Promise<string[]> {
  const cached = lastKnownModelsWhileDown.get(host.serverId);
  if (cached) return cached;

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
  let resolved: string[];
  if (realModelIds.length > 0) {
    resolved = realModelIds;
  } else if (host.configuredModels.length > 0) {
    resolved = host.configuredModels;
  } else {
    // Nothing real is known for this host — neither history nor config — so
    // record the host as down rather than letting it vanish from the chart
    // with zero rows. The sentinel is never mixed with real model ids.
    resolved = [UNKNOWN_MODEL_SENTINEL];
  }
  lastKnownModelsWhileDown.set(host.serverId, resolved);
  return resolved;
}

async function sampleHost(host: StatusHost, intervalMinutes: number): Promise<SampleRow[]> {
  let health: HostHealth;
  let load: VllmLoad | null = null;

  try {
    ({ health, load } = await probeHost(host));
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
    forgetDownHostModels(host.serverId);
    const models = health.modelIds ?? [];
    if (models.length === 0) {
      // A host that answers /v1/models with an empty list wrote no rows at all,
      // so it vanished from the fleet and the chip read green over whichever
      // hosts survived — the aggregate degrades on `up < total`, and this host
      // was in neither count. It can serve nothing, which is that host's
      // outage however politely it answered; the reason it differs from an
      // unreachable host is recorded in `detail`, not thrown away.
      return [
        {
          serverId: host.serverId,
          modelId: UNKNOWN_MODEL_SENTINEL,
          state: "OUTAGE" as const,
          reachable: false,
          waiting: null,
          cacheUsage: null,
          intervalMinutes,
          detail: "host reachable but advertising no models",
        },
      ];
    }
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

/** The cron job name this probe runs under — the key its schedule override is stored against. */
const JOB_NAME = "ai-status-probe";

/**
 * The cadence ACTUALLY in force, which is the admin's schedule override when
 * there is one and only otherwise the env default.
 *
 * `intervalMinutes` exists so the reader never depends on env to judge
 * staleness; stamping `pollMinutes()` made the writer depend on it instead. An
 * admin retuning the job to hourly left rows claiming 15, so the reader's
 * three-interval horizon expired 45 minutes into every hour and the chip
 * flapped to `unknown`; retuning downward hid a dead worker for three times as
 * long. A schedule we cannot read as a fixed period falls back to the default
 * rather than to a guess.
 */
async function cadenceInForceMinutes(): Promise<number> {
  try {
    const override = await prisma.cronJobScheduleOverride.findUnique({
      where: { jobName: JOB_NAME },
      select: { schedule: true },
    });
    return minutesFromCron(override?.schedule) ?? pollMinutes();
  } catch {
    // The override table being unreadable must not stop the probe writing
    // samples; the env default is the same answer it gave before.
    return pollMinutes();
  }
}

export async function runAiStatusProbe(): Promise<{ message: string }> {
  const hosts = resolveStatusHosts();
  if (hosts.length === 0) {
    return { message: "No UBC-hosted inference configured; nothing sampled" };
  }

  const intervalMinutes = await cadenceInForceMinutes();
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
