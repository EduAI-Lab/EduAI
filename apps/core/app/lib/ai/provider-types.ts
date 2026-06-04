/** Shared provider types and static config — safe for client hooks and unit tests. */

export type SupportedProvider = 'openai' | 'google' | 'ollama' | 'vllm';

/** Local inference providers that do not require a user API key. */
export const LOCAL_INFERENCE_PROVIDERS: SupportedProvider[] = ['ollama', 'vllm'];

export interface UserProviderSettings {
  [key: string]: {
    apiKey?: string;
    isEnabled: boolean;
    baseUrl?: string;
  };
}

export interface ProviderConfig {
  id: SupportedProvider;
  name: string;
  description: string;
  requiresApiKey: boolean;
  defaultBaseUrl?: string;
  envVarName?: string;
}

export const PROVIDER_CONFIGS: Record<SupportedProvider, ProviderConfig> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    description: 'Advanced AI models including GPT-4, GPT-4o, and o1',
    requiresApiKey: true,
    envVarName: 'OPENAI_API_KEY',
  },
  google: {
    id: 'google',
    name: 'Google AI',
    description: 'Gemini models for multimodal AI applications',
    requiresApiKey: true,
    envVarName: 'GOOGLE_GENERATIVE_AI_API_KEY',
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama',
    description: 'Local AI models running on Ollama',
    requiresApiKey: false,
    defaultBaseUrl: 'http://localhost:11434/api',
    envVarName: 'OLLAMA_BASE_URL',
  },
  vllm: {
    id: 'vllm',
    name: 'vLLM',
    description: 'Local OpenAI-compatible inference (vLLM on cmps01 or tunnel)',
    requiresApiKey: false,
    defaultBaseUrl: 'http://localhost:8001/v1',
    envVarName: 'VLLM_BASE_URL',
  },
};

export function parseModelIdentifier(
  identifier: string,
): { providerId: SupportedProvider; modelId: string } | null {
  if (!identifier || typeof identifier !== 'string') return null;

  const firstColonIndex = identifier.indexOf(':');
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
): UserProviderSettings {
  const merged: UserProviderSettings = { ...userSettings };
  const parsed = modelIdentifier ? parseModelIdentifier(modelIdentifier) : null;
  const providerIds = parsed ? [parsed.providerId] : LOCAL_INFERENCE_PROVIDERS;

  for (const providerId of providerIds) {
    const envVar = PROVIDER_CONFIGS[providerId]?.envVarName;
    const envUrl = envVar ? process.env[envVar] : undefined;
    const requestedOnThisChat = parsed?.providerId === providerId;

    if (requestedOnThisChat && envUrl) {
      merged[providerId] = {
        ...merged[providerId],
        isEnabled: true,
        baseUrl: merged[providerId]?.baseUrl || envUrl,
      };
      continue;
    }

    if (merged[providerId]?.isEnabled) continue;

    if (envUrl) {
      merged[providerId] = { isEnabled: true, baseUrl: envUrl };
    }
  }

  return merged;
}
