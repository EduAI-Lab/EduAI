import { resolveAllowedLocalInferenceBaseUrl } from "./local-inference-url.server";

export class InvalidVllmBaseUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidVllmBaseUrlError";
  }
}

function defaultVllmBaseUrl(): string {
  const port = process.env.VLLM_PORT?.trim() || "8001";
  return `http://localhost:${port}`;
}

/** Hostnames of every vLLM endpoint the deployment has explicitly configured via env. */
function configuredVllmHostnames(): Set<string> {
  const hosts = new Set<string>();
  const rawUrls = [
    process.env.VLLM_BASE_URL,
    process.env.VLLM_EMBEDDING_BASE_URL,
    process.env.VLLM_FLEET_HEAVY_URL,
    ...(process.env.VLLM_FLEET_CHAT_URLS?.split(",") ?? []),
  ];
  for (const raw of rawUrls) {
    const trimmed = raw?.trim();
    if (!trimmed) continue;
    try {
      hosts.add(new URL(trimmed).hostname.toLowerCase());
    } catch {
      // ignore malformed env entries
    }
  }
  return hosts;
}

/**
 * Restricts user-supplied vLLM endpoints to loopback or a hostname explicitly
 * configured by the deployment (VLLM_BASE_URL / VLLM_FLEET_CHAT_URLS /
 * VLLM_FLEET_HEAVY_URL). Mirrors resolveAllowedOllamaBaseUrl's SSRF guard via
 * the shared resolveAllowedLocalInferenceBaseUrl helper.
 */
export function resolveAllowedVllmBaseUrl(raw?: string | null): string {
  return resolveAllowedLocalInferenceBaseUrl(raw, {
    label: "vLLM",
    defaultBaseUrl: process.env.VLLM_BASE_URL?.trim() || defaultVllmBaseUrl(),
    allowedHostnames: configuredVllmHostnames(),
    createError: (message) => new InvalidVllmBaseUrlError(message),
  });
}
