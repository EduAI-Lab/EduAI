import {
  canonicalLocalInferenceBaseUrl,
  resolveAllowedLocalInferenceBaseUrl,
} from "./local-inference-url.server";

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

/** Exact bases of every vLLM endpoint the deployment has configured via env. */
function configuredVllmBaseUrls(): Set<string> {
  const bases = new Set<string>();
  let hasConfiguredEntry = false;
  const rawUrls = [
    process.env.VLLM_BASE_URL,
    process.env.CMPS01_INTERNAL_BASE_URL,
    ...(process.env.VLLM_TRUSTED_BASE_URLS?.split(",") ?? []),
    process.env.VLLM_FLEET_HEAVY_URL,
    ...(process.env.VLLM_FLEET_CHAT_URLS?.split(",") ?? []),
  ];
  for (const raw of rawUrls) {
    const trimmed = raw?.trim();
    if (!trimmed) continue;
    hasConfiguredEntry = true;
    const canonical = canonicalLocalInferenceBaseUrl(trimmed);
    if (!canonical) continue;
    bases.add(canonical);
    if (canonical.endsWith("/v1")) bases.add(canonical.slice(0, -3));
  }
  if (!hasConfiguredEntry) {
    const fallback = canonicalLocalInferenceBaseUrl(defaultVllmBaseUrl());
    if (fallback) bases.add(fallback);
  }
  return bases;
}

/**
 * Restricts user-supplied vLLM endpoints to an exact deployment-owned base
 * (VLLM_BASE_URL / VLLM_FLEET_CHAT_URLS / VLLM_FLEET_HEAVY_URL); development
 * may additionally use loopback for local tooling.
 */
export function resolveAllowedVllmBaseUrl(raw?: string | null): string {
  return resolveAllowedLocalInferenceBaseUrl(raw, {
    label: "vLLM",
    defaultBaseUrl: process.env.VLLM_BASE_URL?.trim() || defaultVllmBaseUrl(),
    allowedBaseUrls: configuredVllmBaseUrls(),
    createError: (message) => new InvalidVllmBaseUrlError(message),
  });
}
