const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export class InvalidVllmBaseUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidVllmBaseUrlError";
  }
}

function parseHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new InvalidVllmBaseUrlError("Invalid vLLM base URL");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new InvalidVllmBaseUrlError("vLLM base URL must use HTTP(S) without credentials");
  }
  return url;
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
 * VLLM_FLEET_HEAVY_URL). Mirrors resolveAllowedOllamaBaseUrl's SSRF guard.
 * Hostname matching only — DNS rebind to link-local IPs is a known follow-up,
 * same caveat as the Ollama guard.
 */
export function resolveAllowedVllmBaseUrl(raw?: string | null): string {
  const configuredRaw = process.env.VLLM_BASE_URL?.trim() || defaultVllmBaseUrl();
  const candidate = parseHttpUrl(raw?.trim() || configuredRaw);

  const allowedHosts = configuredVllmHostnames();
  const candidateHost = candidate.hostname.toLowerCase();
  if (!LOOPBACK_HOSTS.has(candidateHost) && !allowedHosts.has(candidateHost)) {
    throw new InvalidVllmBaseUrlError(
      "vLLM base URL host must match a server-configured VLLM host or be loopback",
    );
  }

  return candidate.toString().replace(/\/$/, "");
}
