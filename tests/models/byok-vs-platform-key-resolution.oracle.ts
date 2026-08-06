/**
 * Oracle for tests/models/byok-vs-platform-key-resolution.pict (census § S3).
 *
 * Spec-derived resolution tags for local-inference provider settings (issue #1182),
 * modeled from `mergeLocalInferenceFromEnv` (provider-types.ts) and vLLM apiKey
 * precedence in `createAIProviderRegistry` (providers.ts) — not secret values:
 *
 *   baseUrl (when provider becomes enabled):
 *     vLLM:  fleet override > user BYOK baseUrl > deployment env (VLLM_BASE_URL)
 *     Ollama: user BYOK baseUrl > deployment env (OLLAMA_BASE_URL)
 *   apiKey (vLLM only, when enabled):
 *     user BYOK apiKey > platform env (VLLM_API_KEY) > built-in default token
 *
 * Provider stays disabled when no deployment URL is available after fleet merge
 * (mergeLocalInferenceFromEnv skips the provider when envUrl is empty).
 *
 * App-agnostic: adapters assert source tags against mergeLocalInferenceFromEnv output.
 */

export type ByokKeyResolutionRow = {
  Provider: "vllm" | "ollama";
  FleetBaseUrl: "set" | "unset";
  UserBaseUrl: "set" | "unset";
  EnvBaseUrl: "set" | "unset";
  UserApiKey: "set" | "unset";
  PlatformKey: "set" | "unset";
};

export type BaseUrlSource = "fleet" | "user" | "env" | "none";
export type KeySource = "user" | "platform" | "default" | "none";

export type ByokKeyResolutionVerdict = {
  enabled: boolean;
  baseUrlSource: BaseUrlSource;
  keySource: KeySource;
};

/** Whether mergeLocalInferenceFromEnv would see a non-empty envUrl for this row. */
function hasDeploymentUrl(row: ByokKeyResolutionRow): boolean {
  if (row.Provider === "vllm" && row.FleetBaseUrl === "set") {
    return true;
  }
  return row.EnvBaseUrl === "set";
}

export function byokKeyResolutionOracle(row: ByokKeyResolutionRow): ByokKeyResolutionVerdict {
  if (!hasDeploymentUrl(row)) {
    return { enabled: false, baseUrlSource: "none", keySource: "none" };
  }

  let baseUrlSource: BaseUrlSource;
  if (row.Provider === "vllm" && row.FleetBaseUrl === "set") {
    baseUrlSource = "fleet";
  } else if (row.UserBaseUrl === "set") {
    baseUrlSource = "user";
  } else {
    baseUrlSource = "env";
  }

  if (row.Provider === "ollama") {
    return { enabled: true, baseUrlSource, keySource: "none" };
  }

  let keySource: KeySource;
  if (row.UserApiKey === "set") {
    keySource = "user";
  } else if (row.PlatformKey === "set") {
    keySource = "platform";
  } else {
    keySource = "default";
  }

  return { enabled: true, baseUrlSource, keySource };
}

/** Tag-only assertion helper: which URL bucket won without comparing secret hosts. */
export function expectedBaseUrlSource(row: ByokKeyResolutionRow): BaseUrlSource {
  return byokKeyResolutionOracle(row).baseUrlSource;
}

/** Tag-only assertion helper for vLLM apiKey precedence. */
export function expectedKeySource(row: ByokKeyResolutionRow): KeySource {
  return byokKeyResolutionOracle(row).keySource;
}
