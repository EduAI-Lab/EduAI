import {
  canonicalLocalInferenceBaseUrl,
  resolveAllowedLocalInferenceBaseUrl,
} from "./local-inference-url.server";

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/api";

export class InvalidOllamaBaseUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOllamaBaseUrlError";
  }
}

/** Exact deployment-owned Ollama bases, with the provider's optional /api alias. */
function configuredOllamaBaseUrls(): Set<string> {
  const allowed = new Set<string>();
  const raw = process.env.OLLAMA_BASE_URL?.trim();
  const configured = raw || DEFAULT_OLLAMA_BASE_URL;
  const canonical = canonicalLocalInferenceBaseUrl(configured);
  if (canonical) {
    allowed.add(canonical);
    if (canonical.endsWith("/api")) allowed.add(canonical.slice(0, -4));
  }
  return allowed;
}

/**
 * Restricts user-supplied Ollama endpoints to an exact deployment-owned base;
 * development may additionally use loopback for local tooling.
 */
export function resolveAllowedOllamaBaseUrl(raw?: string | null): string {
  return resolveAllowedLocalInferenceBaseUrl(raw, {
    label: "Ollama",
    defaultBaseUrl: process.env.OLLAMA_BASE_URL?.trim() || DEFAULT_OLLAMA_BASE_URL,
    allowedBaseUrls: configuredOllamaBaseUrls(),
    createError: (message) => new InvalidOllamaBaseUrlError(message),
  });
}

export function ollamaTagsUrl(raw?: string | null): string {
  return resolveAllowedOllamaBaseUrl(raw).replace(/\/api$/, "") + "/api/tags";
}
