import { resolveAllowedLocalInferenceBaseUrl } from "./local-inference-url.server";

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/api";

export class InvalidOllamaBaseUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOllamaBaseUrlError";
  }
}

/** Hostname of the deployment-configured Ollama endpoint, if OLLAMA_BASE_URL is set and valid. */
function configuredOllamaHostnames(): Set<string> {
  const raw = process.env.OLLAMA_BASE_URL?.trim();
  if (!raw) return new Set();
  try {
    return new Set([new URL(raw).hostname.toLowerCase()]);
  } catch {
    return new Set();
  }
}

/**
 * Restricts user-supplied Ollama endpoints to loopback or the hostname
 * explicitly configured by the deployment.
 */
export function resolveAllowedOllamaBaseUrl(raw?: string | null): string {
  return resolveAllowedLocalInferenceBaseUrl(raw, {
    label: "Ollama",
    defaultBaseUrl: process.env.OLLAMA_BASE_URL?.trim() || DEFAULT_OLLAMA_BASE_URL,
    allowedHostnames: configuredOllamaHostnames(),
    createError: (message) => new InvalidOllamaBaseUrlError(message),
  });
}

export function ollamaTagsUrl(raw?: string | null): string {
  return resolveAllowedOllamaBaseUrl(raw).replace(/\/api$/, "") + "/api/tags";
}
