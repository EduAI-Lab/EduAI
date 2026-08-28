/**
 * vLLM per-host load probe for the AI model monitor (#1551). Scrapes one vLLM
 * server's Prometheus `/metrics` endpoint — exposed at the host ROOT, not under
 * `/v1` — and extracts the two gauges that indicate inference load:
 *
 *   - `vllm:num_requests_waiting` — requests queued because the GPU / KV-cache is
 *     full. The primary "heavy load" signal: a sustained non-zero queue means
 *     new requests are waiting rather than being served.
 *   - `vllm:gpu_cache_usage_perc` — KV-cache utilisation (0..1). Near-full means
 *     preemption / queuing is imminent.
 *
 * Values are matched by metric NAME, ignoring any `{label=...}` set (newer vLLM
 * tags gauges with `model_name`), so a multi-model host is summed (waiting) or
 * maxed (cache usage) across its series. Sends `Bearer VLLM_API_KEY` in case the
 * metrics endpoint sits behind the same gateway auth as `/v1` (mirrors the fleet
 * health probe). Returns `null` when `/metrics` can't be reached or parsed, so
 * the caller falls back to liveness-only (no degraded-from-load signal).
 */
import { resolveVllmApiKey } from "~/lib/ai/vllm-api-key.server";

const METRICS_TIMEOUT_MS = 2_000;

export interface VllmLoad {
  /** Sum of queued (waiting) requests across all model series on this host. */
  waiting: number;
  /** Max KV-cache utilisation (0..1) across model series on this host. */
  cacheUsage: number;
}

/**
 * Parse every `<name>[{labels}] <value>` sample for a Prometheus metric,
 * ignoring `# HELP` / `# TYPE` comment lines and any label set. Returns the raw
 * numeric values (one per series). Prometheus text format:
 *   metric_name{label="v"} 1.23 [timestamp]
 */
function metricValues(text: string, name: string): number[] {
  const values: number[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimStart();
    if (line.length === 0 || line.charCodeAt(0) === 35 /* '#' */) continue;
    if (!line.startsWith(name)) continue;
    // The char right after the name must end the name token, so a prefix like
    // `vllm:num_requests_waiting_total` doesn't match `vllm:num_requests_waiting`.
    const after = line.charAt(name.length);
    if (after !== " " && after !== "\t" && after !== "{") continue;

    let rest = line.slice(name.length);
    if (rest.startsWith("{")) {
      const close = rest.indexOf("}");
      if (close === -1) continue; // malformed label block
      rest = rest.slice(close + 1);
    }
    const token = rest.trim().split(/\s+/)[0];
    const num = Number(token);
    if (Number.isFinite(num)) values.push(num);
  }
  return values;
}

function sum(values: number[]): number {
  return values.reduce((acc, n) => acc + n, 0);
}

function max(values: number[]): number {
  return values.reduce((acc, n) => (n > acc ? n : acc), 0);
}

/**
 * Probe one vLLM host's `/metrics` for current load. `null` on any failure
 * (unreachable, non-200, unparseable) — the caller treats that as "load
 * unknown" and reports the host on its `/v1/models` liveness alone.
 */
export async function probeVllmLoad(baseUrl: string): Promise<VllmLoad | null> {
  const normalized = baseUrl.replace(/\/$/, "");
  const apiKey = resolveVllmApiKey();
  try {
    const res = await fetch(`${normalized}/metrics`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(METRICS_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const text = await res.text();
    const waitingValues = metricValues(text, "vllm:num_requests_waiting");
    const cacheValues = metricValues(text, "vllm:gpu_cache_usage_perc");
    // A payload that contains neither gauge is not vLLM metrics we understand.
    if (waitingValues.length === 0 && cacheValues.length === 0) return null;
    return {
      waiting: sum(waitingValues),
      cacheUsage: max(cacheValues),
    };
  } catch {
    return null;
  }
}

/** Exposed for unit tests — parse a raw Prometheus payload into a `VllmLoad`. */
export function parseVllmLoad(text: string): VllmLoad {
  return {
    waiting: sum(metricValues(text, "vllm:num_requests_waiting")),
    cacheUsage: max(metricValues(text, "vllm:gpu_cache_usage_perc")),
  };
}
