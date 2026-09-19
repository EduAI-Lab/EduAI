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
 * on a header poll would cost tokens and hit rate limits.
 *
 * This module does no I/O — it is pure classification and aggregation.
 * `classifyCloudStatus` derives the cloud state from env key presence, and
 * `aggregateUbcStatus` folds already-collected per-host probes into a single
 * `ServiceStatus` using env-tunable thresholds. The actual UBC probing happens
 * elsewhere: `apps/core/app/lib/ai/status-probe.server.ts` samples the fleet on a
 * cron and persists the results, and `apps/core/app/lib/ai/status/read.server.ts`
 * reads those samples back and calls `aggregateUbcStatus` here to derive the
 * current UBC state.
 */
import type { VllmLoad } from "~/lib/ai/service-status/vllm-metrics.server";

export type ServiceState = "operational" | "degraded" | "outage" | "unknown";

export interface ServiceStatus {
  state: ServiceState;
  /** Short human-readable explanation for the tooltip. */
  detail: string;
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
