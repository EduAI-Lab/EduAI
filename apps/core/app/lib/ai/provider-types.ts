/** Shared provider types and static config — safe for client hooks and unit tests. */

export type SupportedProvider = "openai" | "google" | "ollama" | "vllm" | "opencode" | "bedrock";

/**
 * Local inference providers that do not require a user API key.
 * Bedrock is intentionally excluded: mergeLocalInferenceFromEnv uses this
 * list to auto-enable a provider from env vars. Bedrock may only be enabled
 * by the overflow decision (#1441), never as a normal pool member.
 */
export const LOCAL_INFERENCE_PROVIDERS: SupportedProvider[] = ["ollama", "vllm"];

export interface UserProviderSettings {
  [key: string]: {
    apiKey?: string;
    isEnabled: boolean;
    baseUrl?: string;
  };
}

// Kept out of the serialized settings object so a client payload cannot forge
// deployment provenance and receive internal provider credentials/headers.
const deploymentManagedSettings = new WeakSet<object>();

export function isDeploymentManagedProviderSettings(
  settings: UserProviderSettings[string] | undefined,
): boolean {
  return Boolean(settings && deploymentManagedSettings.has(settings));
}

export interface ProviderConfig {
  id: SupportedProvider;
  name: string;
  description: string;
  requiresApiKey: boolean;
  defaultBaseUrl?: string;
  envVarName?: string;
}

export const PROVIDER_CONFIGS = {
  openai: {
    id: "openai",
    name: "OpenAI",
    description: "Advanced AI models including GPT-4, GPT-4o, and o1",
    requiresApiKey: true,
    envVarName: "OPENAI_API_KEY",
  },
  google: {
    id: "google",
    name: "Google AI",
    description: "Gemini models for multimodal AI applications",
    requiresApiKey: true,
    envVarName: "GOOGLE_GENERATIVE_AI_API_KEY",
  },
  ollama: {
    id: "ollama",
    name: "Ollama",
    description: "Local AI models running on Ollama",
    requiresApiKey: false,
    defaultBaseUrl: "http://localhost:11434/api",
    envVarName: "OLLAMA_BASE_URL",
  },
  vllm: {
    id: "vllm",
    name: "vLLM",
    description: "Local OpenAI-compatible inference (vLLM on cmps01 or tunnel)",
    requiresApiKey: false,
    defaultBaseUrl: "http://localhost:8001/v1",
    envVarName: "VLLM_BASE_URL",
  },
  opencode: {
    id: "opencode",
    name: "OpenCode Go",
    description: "OpenCode Go subscription models, including Muse Spark and DeepSeek V4 Flash",
    requiresApiKey: true,
    defaultBaseUrl: "https://opencode.ai/zen/go/v1",
    // Its key is account-scoped BYOK, so there is no deployment env var.
    envVarName: undefined,
  },
  bedrock: {
    id: "bedrock",
    name: "Amazon Bedrock",
    description: "Overflow-only Amazon Bedrock (Llama 3 Instruct 70B)",
    requiresApiKey: false,
    envVarName: "AWS_BEARER_TOKEN_BEDROCK",
  },
} satisfies Record<SupportedProvider, ProviderConfig>;

/**
 * Explains where a missing provider configuration belongs. Cloud providers
 * are account-scoped BYOK settings; local providers remain deployment env.
 */
export function providerConfigurationHint(providerId: string): string {
  if (providerId === "ollama") {
    return "Set OLLAMA_BASE_URL in apps/core/.env and restart the dev process.";
  }
  if (providerId === "vllm") {
    return "Set VLLM_BASE_URL in apps/core/.env and restart the dev process.";
  }
  return "Configure this provider in the calling app's API-key settings.";
}

export function parseModelIdentifier(
  identifier: string,
): { providerId: SupportedProvider; modelId: string } | null {
  if (!identifier) return null;

  const firstColonIndex = identifier.indexOf(":");
  if (firstColonIndex === -1) return null;

  const providerId = identifier.slice(0, firstColonIndex);
  const modelId = identifier.slice(firstColonIndex + 1);

  if (!providerId || !modelId) return null;
  if (!Object.keys(PROVIDER_CONFIGS).includes(providerId)) return null;

  return { providerId: providerId as SupportedProvider, modelId };
}

export function mergeLocalInferenceFromEnv(
  userSettings: UserProviderSettings,
  modelIdentifier?: string,
  vllmBaseUrlOverride?: string,
): UserProviderSettings {
  const merged: UserProviderSettings = {};
  for (const [providerId, settings] of Object.entries(userSettings)) {
    const entry: UserProviderSettings[string] = { ...settings };
    if (isDeploymentManagedProviderSettings(settings)) deploymentManagedSettings.add(entry);
    merged[providerId] = entry;
  }
  const parsed = modelIdentifier ? parseModelIdentifier(modelIdentifier) : null;
  const providerIds = parsed
    ? LOCAL_INFERENCE_PROVIDERS.includes(parsed.providerId)
      ? [parsed.providerId]
      : []
    : LOCAL_INFERENCE_PROVIDERS;

  const fleetVllmUrl = vllmBaseUrlOverride?.trim();

  for (const providerId of providerIds) {
    const envVar = PROVIDER_CONFIGS[providerId]?.envVarName;
    let envUrl = envVar ? process.env[envVar]?.trim() : undefined;
    if (providerId === "vllm" && fleetVllmUrl) {
      envUrl = fleetVllmUrl;
    }
    if (!envUrl) continue;

    // Server-managed: availability follows apps/core/.env on the app host, not browser toggles.
    const existing = merged[providerId];
    const baseUrl =
      fleetVllmUrl && providerId === "vllm" ? fleetVllmUrl : existing?.baseUrl || envUrl;
    const entry: UserProviderSettings[string] = {
      ...existing,
      isEnabled: true,
      baseUrl,
    };
    if (fleetVllmUrl || !existing?.baseUrl || isDeploymentManagedProviderSettings(existing)) {
      deploymentManagedSettings.add(entry);
    }
    merged[providerId] = entry;
  }

  return merged;
}
