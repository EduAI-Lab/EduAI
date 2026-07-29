/**
 * Resolve the LiteLLM / vLLM OpenAI-compatible API key.
 *
 * Production never falls back to the documented example `vllm-local` (#1115).
 * Local/dev/test may still use that default when VLLM_API_KEY is unset so
 * laptop workflows keep working against a local LiteLLM that uses the example key.
 *
 * On cmps01 + s378, set VLLM_API_KEY to the same value as CMPS01_INTERNAL_KEY
 * (deploy-edge-proxy.sh renders LiteLLM master_key from that secret).
 */
export function resolveVllmApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const fromEnv = env.VLLM_API_KEY?.trim();
  if (fromEnv) return fromEnv;

  if (env.NODE_ENV === "production") {
    return undefined;
  }

  return "vllm-local";
}
