/**
 * Dual AI-service status (issues #764, #1551 — feeds the shared header
 * `AIServiceIndicators`). Reports two independent provider paths so it's obvious
 * which one is live, and at what health:
 *   - `cloud` — hosted APIs (OpenAI / Google / OpenRouter), keyed by env.
 *   - `ubc`   — UBC-hosted local inference. This is a FLEET of vLLM servers
 *               (see `lib/ai/routing/fleet`), not one box; the status aggregates
 *               liveness + load across every fleet host.
 *
 * Three health tiers (#1551): `operational` (up + healthy), `degraded` (up but
 * strained — some fleet hosts down, or the reachable hosts are under heavy load),
 * `outage` (all down / none reachable). `unknown` is reserved for callers that
 * can't determine a state.
 *
 * Cloud is reported from key presence rather than a live call: pinging a paid API
 * on a header poll would cost tokens and hit rate limits. The UBC path is on
 * internal infra, so short reachability + `/metrics` probes are cheap and
 * meaningful. Results are cached briefly so many concurrent header polls collapse
 * to one probe.
 */
import { getAllFleetServers, fleetRoutingEnabled } from "~/lib/ai/routing/fleet/registry";
import { getServerHealth } from "~/lib/ai/routing/fleet/health";
import { probeVllmLoad, type VllmLoad } from "~/lib/ai/service-status/vllm-metrics.server";

export type ServiceState = "operational" | "degraded" | "outage" | "unknown";

export interface ServiceStatus {
  state: ServiceState;
  /** Short human-readable explanation for the tooltip. */
  detail: string;
}

export interface AiServiceStatus {
  cloud: ServiceStatus;
  ubc: ServiceStatus;
}

/** Fleet-load thresholds above which the UBC path is reported `degraded`. */
export interface LoadThresholds {
  /** Aggregate queued (`vllm:num_requests_waiting`) across reachable hosts. */
  waiting: number;
  /** Max KV-cache utilisation (`vllm:gpu_cache_usage_perc`, 0..1) on any host. */
  cachePct: number;
}

const DEFAULT_WAITING_THRESHOLD = 4;
const DEFAULT_CACHE_PCT_THRESHOLD = 0.9;

function nonNegativeNumber(raw: string | undefined, fallback: number): number {
  // Guard empty / whitespace first: Number("") and Number("  ") are 0 (finite,
  // >= 0), so a blank env line (`VLLM_DEGRADED_WAITING=`) would otherwise pin the
  // threshold to 0 and flag the fleet degraded under any load. Treat blank as unset.
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Degraded thresholds, env-tunable so ops can retune without a redeploy:
 *   - `VLLM_DEGRADED_WAITING`  (default 4)   — a brief queue is normal; degrade
 *      only once the aggregate backlog is sustained.
 *   - `VLLM_DEGRADED_CACHE_PCT` (default 0.9) — KV-cache near full → preemption.
 */
export function resolveLoadThresholds(env: NodeJS.ProcessEnv = process.env): LoadThresholds {
  return {
    waiting: nonNegativeNumber(env.VLLM_DEGRADED_WAITING, DEFAULT_WAITING_THRESHOLD),
    cachePct: nonNegativeNumber(env.VLLM_DEGRADED_CACHE_PCT, DEFAULT_CACHE_PCT_THRESHOLD),
  };
}

/**
 * Classify the cloud path from available API keys. Pure — the caller passes the
 * resolved key strings so this stays unit-testable without touching process.env.
 */
export function classifyCloudStatus(keys: {
  openai?: string | null;
  google?: string | null;
  openrouter?: string | null;
}): ServiceStatus {
  const live: string[] = [];
  if (keys.openai?.trim()) live.push("OpenAI");
  if (keys.google?.trim()) live.push("Google");
  if (keys.openrouter?.trim()) live.push("OpenRouter");

  if (live.length === 0) {
    return { state: "outage", detail: "No cloud API key configured." };
  }
  return { state: "operational", detail: `Cloud providers configured: ${live.join(", ")}.` };
}

/** The UBC-hosted endpoints to probe; a missing one is simply not configured. */
export type UbcBaseUrls = { vllm?: string; ollama?: string };

/** The legacy single-URL UBC bases, used only when fleet routing is disabled. */
export function resolveUbcBaseUrls(env: NodeJS.ProcessEnv = process.env): UbcBaseUrls {
  return {
    vllm: env.VLLM_BASE_URL?.trim() || undefined,
    ollama: env.OLLAMA_BASE_URL?.trim() || undefined,
  };
}

/** One UBC host's probe result. `load: null` = load unknown (Ollama, or /metrics failed). */
export interface HostProbe {
  reachable: boolean;
  load: VllmLoad | null;
}

/**
 * Aggregate per-host probes into one UBC status. Pure, so the tiering logic is
 * unit-testable without any network. Tiers:
 *   - no hosts configured / all unreachable → `outage`
 *   - some hosts down, OR reachable hosts under heavy load → `degraded`
 *   - all hosts reachable with headroom → `operational`
 */
export function aggregateUbcStatus(probes: HostProbe[], thresholds: LoadThresholds): ServiceStatus {
  const total = probes.length;
  if (total === 0) {
    return { state: "outage", detail: "No UBC-hosted inference configured." };
  }

  const reachableHosts = probes.filter((p) => p.reachable);
  const up = reachableHosts.length;
  if (up === 0) {
    return { state: "outage", detail: "UBC-hosted inference is configured but unreachable." };
  }

  const loads = reachableHosts.map((p) => p.load).filter((l): l is VllmLoad => l !== null);
  const totalWaiting = loads.reduce((acc, l) => acc + l.waiting, 0);
  const maxCache = loads.reduce((acc, l) => (l.cacheUsage > acc ? l.cacheUsage : acc), 0);

  const reasons: string[] = [];
  if (up < total) reasons.push(`${up}/${total} hosts reachable`);
  if (totalWaiting > thresholds.waiting) reasons.push(`heavy load — ${totalWaiting} queued`);
  if (maxCache > thresholds.cachePct) {
    reasons.push(`KV-cache ${Math.round(maxCache * 100)}% full`);
  }

  if (reasons.length > 0) {
    return { state: "degraded", detail: `UBC-hosted inference degraded: ${reasons.join("; ")}.` };
  }

  const scope = total > 1 ? ` (${up}/${total} hosts healthy)` : "";
  return { state: "operational", detail: `UBC-hosted inference is reachable${scope}.` };
}

/** GET a URL with a hard timeout; true iff it responds (any HTTP status). */
async function reachable(url: string, timeoutMs = 1500): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(url, { method: "GET", signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function probeUbcStatus(): Promise<ServiceStatus> {
  const thresholds = resolveLoadThresholds();

  // Fleet mode: probe every configured vLLM host for liveness (/v1/models, via
  // the cached fleet health check) and load (/metrics), then aggregate.
  if (fleetRoutingEnabled()) {
    const servers = getAllFleetServers();
    const probes = await Promise.all(
      servers.map(async (server): Promise<HostProbe> => {
        const [health, load] = await Promise.all([
          getServerHealth(server.baseUrl),
          probeVllmLoad(server.baseUrl),
        ]);
        return { reachable: health.ok, load };
      }),
    );
    return aggregateUbcStatus(probes, thresholds);
  }

  // Legacy single-URL mode (no fleet.config.json / fleet env vars). vLLM is
  // OpenAI-compatible (/models) and also exposes /metrics; Ollama (/tags) has no
  // load metrics, so it reports liveness only.
  const { vllm, ollama } = resolveUbcBaseUrls();
  if (!vllm && !ollama) {
    return { state: "outage", detail: "No UBC-hosted inference URL configured." };
  }

  const probes: HostProbe[] = [];
  if (vllm) {
    const base = vllm.replace(/\/$/, "");
    const [live, load] = await Promise.all([reachable(`${base}/models`), probeVllmLoad(base)]);
    probes.push({ reachable: live, load });
  }
  if (ollama) {
    const base = ollama.replace(/\/$/, "");
    probes.push({ reachable: await reachable(`${base}/tags`), load: null });
  }
  return aggregateUbcStatus(probes, thresholds);
}

// Short in-memory cache so a burst of header polls triggers at most one probe.
const CACHE_TTL_MS = 30_000;
let cache: { at: number; value: AiServiceStatus } | null = null;
// Holds the probe promise while it's running so concurrent callers on a cold
// cache share the single in-flight probe instead of each firing their own.
let inFlight: Promise<AiServiceStatus> | null = null;

/** Clear the status cache (unit tests / after a config change). */
export function resetAiServiceStatusCache(): void {
  cache = null;
  inFlight = null;
}

export async function getAiServiceStatus(): Promise<AiServiceStatus> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return cache.value;
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const cloud = classifyCloudStatus({
        openai: process.env.OPENAI_API_KEY,
        google: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
        openrouter: process.env.OPENROUTER_API_KEY,
      });
      const ubc = await probeUbcStatus();

      const value: AiServiceStatus = { cloud, ubc };
      cache = { at: Date.now(), value };
      return value;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
