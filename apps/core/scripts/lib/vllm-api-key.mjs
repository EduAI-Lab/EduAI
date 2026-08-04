/**
 * Shared production-key resolver policy for the vLLM smoke scripts (#1115).
 *
 * Mirrors apps/core/app/lib/ai/vllm-api-key.server.ts's resolveVllmApiKey:
 * production never falls back to the documented example `vllm-local`.
 * Local/dev may still use that default when VLLM_API_KEY is unset.
 *
 * This is a separate .mjs copy (not an import of the .server.ts module)
 * because these scripts run standalone under plain node, outside the Remix/
 * TS build. Keep the two in sync if the production rule ever changes.
 */
export function resolveSmokeApiKey(env = process.env) {
  const fromEnv = env.VLLM_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  if (env.NODE_ENV === "production") return undefined;
  return "vllm-local";
}
