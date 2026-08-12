const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function pointsAtNonLoopbackHost(rawBaseUrl) {
  const trimmed = rawBaseUrl?.trim();
  if (!trimmed) return false;
  try {
    return !LOOPBACK_HOSTNAMES.has(new URL(trimmed).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Shared production-key resolver policy for the vLLM smoke scripts (#1115).
 *
 * Mirrors apps/core/app/lib/ai/vllm-api-key.server.ts's resolveVllmApiKey:
 * never falls back to the documented example `vllm-local` once a deployment
 * explicitly points at a real, non-loopback vLLM host (NODE_ENV=production,
 * or VLLM_BASE_URL set to something other than localhost — s378 runs
 * NODE_ENV=development but sets VLLM_BASE_URL to point at cmps01, so
 * NODE_ENV alone doesn't catch it).
 *
 * This is a separate .mjs copy (not an import of the .server.ts module)
 * because these scripts run standalone under plain node, outside the Remix/
 * TS build. Keep the two in sync if the production rule ever changes.
 */
export function resolveSmokeApiKey(env = process.env) {
  const fromEnv = env.VLLM_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  if (env.NODE_ENV === "production" || pointsAtNonLoopbackHost(env.VLLM_BASE_URL)) return undefined;
  return "vllm-local";
}
