const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

/** True when VLLM_BASE_URL points somewhere other than loopback — a deployment-configured host, not a bare local default. */
function pointsAtNonLoopbackHost(rawBaseUrl: string | undefined): boolean {
  const trimmed = rawBaseUrl?.trim();
  if (!trimmed) return false;
  try {
    return !LOOPBACK_HOSTNAMES.has(new URL(trimmed).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Resolve the LiteLLM / vLLM OpenAI-compatible API key.
 *
 * Never falls back to the documented example `vllm-local` (#1115) once a
 * deployment has explicitly pointed at a real, non-loopback vLLM host:
 * `NODE_ENV=production`, or `VLLM_BASE_URL` set to something other than
 * localhost. NODE_ENV alone doesn't cover s378, which intentionally runs
 * `NODE_ENV=development` (see docs/DEPLOYMENT.md) so `import.meta.env.DEV`
 * stays true there, but still sets `VLLM_BASE_URL` to point at cmps01 — the
 * one place this guard has to fire outside a true production build. A
 * loopback `VLLM_BASE_URL` (or nothing configured) still gets the
 * `vllm-local` convenience fallback, so laptop workflows pointing at a local
 * vLLM/LiteLLM keep working.
 *
 * On cmps01 + s378, set VLLM_API_KEY to the same value as CMPS01_INTERNAL_KEY
 * (deploy-edge-proxy.sh renders LiteLLM master_key from that secret).
 */
export function resolveVllmApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const fromEnv = env.VLLM_API_KEY?.trim();
  if (fromEnv) return fromEnv;

  if (env.NODE_ENV === "production" || pointsAtNonLoopbackHost(env.VLLM_BASE_URL)) {
    return undefined;
  }

  return "vllm-local";
}
