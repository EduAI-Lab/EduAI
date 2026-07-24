const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function parseHttpUrl(raw: string, label: string, createError: (message: string) => Error): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw createError(`Invalid ${label} base URL`);
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw createError(`${label} base URL must use HTTP(S) without credentials`);
  }
  return url;
}

export type LocalInferenceUrlOptions = {
  /** Human-readable name used in error messages, e.g. "Ollama" or "vLLM". */
  label: string;
  /** URL used when `raw` is empty (typically derived from deployment env vars). */
  defaultBaseUrl: string;
  /** Non-loopback hostnames the deployment has explicitly configured as trusted. */
  allowedHostnames: Set<string>;
  /** Constructs the provider-specific error subclass so `instanceof` checks keep working. */
  createError: (message: string) => Error;
};

/**
 * Restricts a user-supplied local-inference endpoint (Ollama, vLLM, ...) to
 * loopback or a hostname explicitly configured by the deployment. Shared by
 * resolveAllowedOllamaBaseUrl and resolveAllowedVllmBaseUrl so the SSRF check
 * only has to be fixed in one place.
 */
export function resolveAllowedLocalInferenceBaseUrl(
  raw: string | null | undefined,
  { label, defaultBaseUrl, allowedHostnames, createError }: LocalInferenceUrlOptions,
): string {
  const candidate = parseHttpUrl(raw?.trim() || defaultBaseUrl, label, createError);
  const candidateHost = candidate.hostname.toLowerCase();
  if (!LOOPBACK_HOSTS.has(candidateHost) && !allowedHostnames.has(candidateHost)) {
    throw createError(`${label} base URL host must match a server-configured host or be loopback`);
  }
  return candidate.toString().replace(/\/$/, "");
}
