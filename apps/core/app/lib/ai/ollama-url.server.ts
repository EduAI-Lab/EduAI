const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/api";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export class InvalidOllamaBaseUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOllamaBaseUrlError";
  }
}

function parseHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new InvalidOllamaBaseUrlError("Invalid Ollama base URL");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new InvalidOllamaBaseUrlError("Ollama base URL must use HTTP(S) without credentials");
  }
  return url;
}

/**
 * Restricts user-supplied Ollama endpoints to loopback or the hostname
 * explicitly configured by the deployment.
 * Hostname matching only — DNS rebind to link-local IPs is a known follow-up
 * (#849 review); main unconstrained-URL SSRF is closed here.
 */
export function resolveAllowedOllamaBaseUrl(raw?: string | null): string {
  const configuredRaw = process.env.OLLAMA_BASE_URL?.trim() || DEFAULT_OLLAMA_BASE_URL;
  const configured = parseHttpUrl(configuredRaw);
  const candidate = parseHttpUrl(raw?.trim() || configuredRaw);

  if (
    !LOOPBACK_HOSTS.has(candidate.hostname.toLowerCase()) &&
    candidate.hostname.toLowerCase() !== configured.hostname.toLowerCase()
  ) {
    throw new InvalidOllamaBaseUrlError(
      "Ollama base URL host must match OLLAMA_BASE_URL or be loopback",
    );
  }

  return candidate.toString().replace(/\/$/, "");
}

export function ollamaTagsUrl(raw?: string | null): string {
  return resolveAllowedOllamaBaseUrl(raw).replace(/\/api$/, "") + "/api/tags";
}
