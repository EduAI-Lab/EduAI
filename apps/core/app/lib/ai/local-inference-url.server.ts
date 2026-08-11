const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function canonicalBaseUrl(url: URL): string {
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${url.host}${path}`;
}

function parseHttpUrl(raw: string, label: string, createError: (message: string) => Error): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw createError(`Invalid ${label} base URL`);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw createError(`${label} base URL must use HTTP(S) without credentials`);
  }
  return url;
}

export type LocalInferenceUrlOptions = {
  /** Human-readable name used in error messages, e.g. "Ollama" or "vLLM". */
  label: string;
  /** URL used when `raw` is empty (typically derived from deployment env vars). */
  defaultBaseUrl: string;
  /** Exact deployment-owned origins/bases accepted in every environment. */
  allowedBaseUrls?: Set<string>;
  /** Constructs the provider-specific error subclass so `instanceof` checks keep working. */
  createError: (message: string) => Error;
};

/**
 * Restricts user-supplied local-inference endpoints (Ollama/vLLM) to an exact
 * deployment-owned base; non-production development may additionally use
 * loopback. Shared by both provider guards so this boundary stays aligned.
 */
export function resolveAllowedLocalInferenceBaseUrl(
  raw: string | null | undefined,
  {
    label,
    defaultBaseUrl,
    allowedBaseUrls = new Set<string>(),
    createError,
  }: LocalInferenceUrlOptions,
): string {
  const candidate = parseHttpUrl(raw?.trim() || defaultBaseUrl, label, createError);
  const candidateHost = candidate.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const exactDeploymentBase = allowedBaseUrls.has(canonicalBaseUrl(candidate));
  const isDevelopmentLoopback =
    process.env.NODE_ENV !== "production" && LOOPBACK_HOSTS.has(candidateHost);
  if (!exactDeploymentBase && !isDevelopmentLoopback) {
    throw createError(
      `${label} base URL must match an exact deployment base or development loopback`,
    );
  }
  return candidate.toString().replace(/\/$/, "");
}

/** Canonical form used to build exact deployment-owned base URL allowlists. */
export function canonicalLocalInferenceBaseUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return canonicalBaseUrl(url);
  } catch {
    return null;
  }
}

/** Safe diagnostic form for rejected client URLs; never logs credentials/path/query secrets. */
export function redactProviderUrlForLog(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.origin;
  } catch {
    return "[redacted invalid URL]";
  }
}
