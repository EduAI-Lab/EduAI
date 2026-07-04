/**
 * Dual AI-service status (issue #764 — parity with QuestionMaker's
 * AIServiceIndicators). Reports two independent provider paths so it's obvious
 * which one is live:
 *   - `cloud`      — hosted APIs (OpenAI / Google / OpenRouter), keyed by env.
 *   - `ubc`        — UBC-hosted local inference (vLLM on cmps01, Ollama), probed
 *                    for reachability.
 *
 * Cloud is reported from key presence rather than a live call: pinging a paid
 * API on a header poll would cost tokens and hit rate limits. The UBC path is on
 * internal infra, so a short reachability probe is cheap and meaningful. Results
 * are cached briefly so many concurrent header polls collapse to one probe.
 */
export type ServiceState = "online" | "offline" | "unknown";

export interface ServiceStatus {
  state: ServiceState;
  /** Short human-readable explanation for the tooltip. */
  detail: string;
}

export interface AiServiceStatus {
  cloud: ServiceStatus;
  ubc: ServiceStatus;
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
    return { state: "offline", detail: "No cloud API key configured." };
  }
  return { state: "online", detail: `Cloud providers configured: ${live.join(", ")}.` };
}

/** The UBC-hosted base URLs to probe, resolved from env (falling back to defaults). */
export function resolveUbcBaseUrls(env: NodeJS.ProcessEnv = process.env): {
  vllm?: string;
  ollama?: string;
} {
  return {
    vllm: env.VLLM_BASE_URL?.trim() || undefined,
    ollama: env.OLLAMA_BASE_URL?.trim() || undefined,
  };
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
  const { vllm, ollama } = resolveUbcBaseUrls();

  if (!vllm && !ollama) {
    return { state: "offline", detail: "No UBC-hosted inference URL configured." };
  }

  // vLLM is OpenAI-compatible (/models); Ollama exposes /tags. Probe whichever
  // is configured — the path is live if either responds.
  const probes: Promise<boolean>[] = [];
  if (vllm) probes.push(reachable(`${vllm.replace(/\/$/, "")}/models`));
  if (ollama) probes.push(reachable(`${ollama.replace(/\/$/, "")}/tags`));

  const results = await Promise.all(probes);
  if (results.some(Boolean)) {
    return { state: "online", detail: "UBC-hosted inference is reachable." };
  }
  return { state: "offline", detail: "UBC-hosted inference is configured but unreachable." };
}

// Short in-memory cache so a burst of header polls triggers at most one probe.
const CACHE_TTL_MS = 30_000;
let cache: { at: number; value: AiServiceStatus } | null = null;

export async function getAiServiceStatus(): Promise<AiServiceStatus> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return cache.value;
  }

  const cloud = classifyCloudStatus({
    openai: process.env.OPENAI_API_KEY,
    google: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
  });
  const ubc = await probeUbcStatus();

  const value: AiServiceStatus = { cloud, ubc };
  cache = { at: now, value };
  return value;
}
