/**
 * AI Provider Registry for EduAI
 * Dynamic provider management with user-provided API keys
 */

import { createProviderRegistry } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOllama } from 'ollama-ai-provider';

// Supported provider types
export type SupportedProvider = 'openai' | 'google' | 'ollama' | 'vllm';

/** Local inference providers that do not require a user API key. */
export const LOCAL_INFERENCE_PROVIDERS: SupportedProvider[] = ['ollama', 'vllm'];

// User provider settings interface
export interface UserProviderSettings {
  [key: string]: {
    apiKey?: string;
    isEnabled: boolean;
    baseUrl?: string;
  };
}

// Provider configuration interface
export interface ProviderConfig {
  id: SupportedProvider;
  name: string;
  description: string;
  requiresApiKey: boolean;
  defaultBaseUrl?: string;
  envVarName?: string;
}

// Provider configurations (static metadata only)
export const PROVIDER_CONFIGS: Record<SupportedProvider, ProviderConfig> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    description: 'Advanced AI models including GPT-4, GPT-4o, and o1',
    requiresApiKey: true,
    envVarName: 'OPENAI_API_KEY'
  },
  google: {
    id: 'google',
    name: 'Google AI',
    description: 'Gemini models for multimodal AI applications',
    requiresApiKey: true,
    envVarName: 'GOOGLE_GENERATIVE_AI_API_KEY'
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama',
    description: 'Local AI models running on Ollama',
    requiresApiKey: false,
    defaultBaseUrl: 'http://localhost:11434/api',
    envVarName: 'OLLAMA_BASE_URL'
  },
  vllm: {
    id: 'vllm',
    name: 'vLLM',
    description: 'Local OpenAI-compatible inference (vLLM on cmps01 or tunnel)',
    requiresApiKey: false,
    defaultBaseUrl: 'http://localhost:8001/v1',
    envVarName: 'VLLM_BASE_URL'
  }
};

/**
 * Creates a dynamic provider registry with user-provided settings
 */
export function createAIProviderRegistry(userSettings: UserProviderSettings) {
  const providers: Record<string, any> = {};

  // OpenAI
  if (userSettings.openai?.isEnabled && userSettings.openai?.apiKey) {
    providers.openai = createOpenAI({
      apiKey: userSettings.openai.apiKey,
    });
  }

  // Google AI
  if (userSettings.google?.isEnabled && userSettings.google?.apiKey) {
    providers.google = createGoogleGenerativeAI({
      apiKey: userSettings.google.apiKey,
    });
  }

  // Ollama
  if (userSettings.ollama?.isEnabled) {
    let baseURL = userSettings.ollama?.baseUrl ||
                  process.env.OLLAMA_BASE_URL ||
                  'http://localhost:11434';

    // Ensure the URL ends with /api for Ollama compatibility
    if (!baseURL.endsWith('/api')) {
      baseURL = baseURL.replace(/\/$/, '') + '/api';
    }

    providers.ollama = createOllama({
      baseURL,
    });
  }

  // vLLM (OpenAI-compatible /v1 — see docs/rag-ai/latency/eduai-summer-2026/VLLM_CMPS01_SETUP.md)
  if (userSettings.vllm?.isEnabled) {
    const vllmPort = process.env.VLLM_PORT || '8001';
    let baseURL =
      userSettings.vllm?.baseUrl ||
      process.env.VLLM_BASE_URL ||
      `http://localhost:${vllmPort}`;

    baseURL = baseURL.replace(/\/$/, '');
    if (!baseURL.endsWith('/v1')) {
      baseURL = `${baseURL}/v1`;
    }

    const apiKey =
      userSettings.vllm?.apiKey ||
      process.env.VLLM_API_KEY ||
      'vllm-local';

    providers.vllm = createOpenAI({
      apiKey,
      baseURL,
    });
  }

  // Create and return the registry
  return createProviderRegistry(providers, { separator: ':' });
}

/**
 * Validates provider configuration
 */
export function validateProviderConfig(
  providerId: SupportedProvider,
  settings: { apiKey?: string; baseUrl?: string }
): { isValid: boolean; error?: string } {
  const config = PROVIDER_CONFIGS[providerId];

  if (!config) {
    return { isValid: false, error: 'Unsupported provider' };
  }

  if (config.requiresApiKey && !settings.apiKey) {
    return { isValid: false, error: 'API key is required for this provider' };
  }

  return { isValid: true };
}

/**
 * Get available provider configurations
 */
export function getAvailableProviders(): ProviderConfig[] {
  return Object.values(PROVIDER_CONFIGS);
}

/**
 * Get provider configuration by ID
 */
export function getProviderConfig(providerId: SupportedProvider): ProviderConfig | null {
  return PROVIDER_CONFIGS[providerId] || null;
}

/**
 * Check if provider is configured in user settings
 */
export function isProviderConfigured(
  providerId: SupportedProvider,
  userSettings: UserProviderSettings
): boolean {
  const userConfig = userSettings[providerId];
  const providerConfig = PROVIDER_CONFIGS[providerId];

  if (!userConfig?.isEnabled) return false;

  // For providers that require API key, check if it's provided
  if (providerConfig?.requiresApiKey && !userConfig.apiKey) {
    return false;
  }

  return true;
}

/**
 * Get model identifier for registry usage (provider:model format)
 */
export function getModelIdentifier(providerId: SupportedProvider, modelId: string): string {
  return `${providerId}:${modelId}`;
}

/**
 * Parse model identifier to extract provider and model IDs
 */
export function parseModelIdentifier(identifier: string): { providerId: SupportedProvider; modelId: string } | null {
  if (!identifier || typeof identifier !== 'string') return null;

  // Allow additional colons in modelId (e.g., "ollama:gpt-oss:120b") by splitting on the first colon only
  const firstColonIndex = identifier.indexOf(':');
  if (firstColonIndex === -1) return null;

  const providerId = identifier.slice(0, firstColonIndex);
  const modelId = identifier.slice(firstColonIndex + 1);

  if (!providerId || !modelId) return null;
  if (!Object.keys(PROVIDER_CONFIGS).includes(providerId)) return null;

  return { providerId: providerId as SupportedProvider, modelId };
}

/**
 * Enable local GPU providers from server env when the browser did not send them
 * (common on dev when only VLLM_BASE_URL / OLLAMA_BASE_URL are set in .env).
 */
export function mergeLocalInferenceFromEnv(
  userSettings: UserProviderSettings,
  modelIdentifier?: string,
): UserProviderSettings {
  const merged: UserProviderSettings = { ...userSettings };
  const parsed = modelIdentifier ? parseModelIdentifier(modelIdentifier) : null;
  const providerIds = parsed ? [parsed.providerId] : LOCAL_INFERENCE_PROVIDERS;

  for (const providerId of providerIds) {
    if (merged[providerId]?.isEnabled) continue;

    const envVar = PROVIDER_CONFIGS[providerId]?.envVarName;
    const envUrl = envVar ? process.env[envVar] : undefined;
    if (envUrl) {
      merged[providerId] = { isEnabled: true, baseUrl: envUrl };
    }
  }

  return merged;
}

