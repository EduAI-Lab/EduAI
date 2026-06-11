/**
 * Server-side AI provider registry (uses env + SDK clients).
 * Client-safe helpers live in providers.shared.ts.
 */

import { createProviderRegistry } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOllama } from 'ollama-ai-provider';
import {
  LOCAL_INFERENCE_PROVIDERS,
  mergeLocalInferenceFromEnv,
  parseModelIdentifier,
  PROVIDER_CONFIGS,
  type ProviderConfig,
  type SupportedProvider,
  type UserProviderSettings,
} from './provider-types';

export type { ProviderConfig, SupportedProvider, UserProviderSettings };
export {
  LOCAL_INFERENCE_PROVIDERS,
  mergeLocalInferenceFromEnv,
  parseModelIdentifier,
  PROVIDER_CONFIGS,
};

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

function createOpenRouterClient(apiKey: string) {
  const referer =
    process.env.OPENROUTER_HTTP_REFERER?.trim() ||
    process.env.BETTER_AUTH_URL?.trim() ||
    undefined;

  return createOpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    headers: {
      ...(referer ? { 'HTTP-Referer': referer } : {}),
      'X-Title': process.env.OPENROUTER_APP_TITLE?.trim() || 'EduAI',
    },
  });
}

/**
 * Creates a dynamic provider registry with user-provided settings
 */
export function createAIProviderRegistry(userSettings: UserProviderSettings) {
  const providers: Record<string, any> = {};

  if (userSettings.openai?.isEnabled && userSettings.openai?.apiKey) {
    providers.openai = createOpenAI({
      apiKey: userSettings.openai.apiKey,
    });
  }

  if (userSettings.google?.isEnabled && userSettings.google?.apiKey) {
    providers.google = createGoogleGenerativeAI({
      apiKey: userSettings.google.apiKey,
    });
  }

  if (userSettings.openrouter?.isEnabled && userSettings.openrouter?.apiKey) {
    providers.openrouter = createOpenRouterClient(userSettings.openrouter.apiKey);
  }

  if (userSettings.ollama?.isEnabled) {
    let baseURL = userSettings.ollama?.baseUrl ||
                  process.env.OLLAMA_BASE_URL ||
                  'http://localhost:11434';

    if (!baseURL.endsWith('/api')) {
      baseURL = baseURL.replace(/\/$/, '') + '/api';
    }

    providers.ollama = createOllama({
      baseURL,
    });
  }

  // vLLM (OpenAI-compatible /v1 — see docs/rag-ai/VLLM.md)
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

  return createProviderRegistry(providers, { separator: ':' });
}

export function validateProviderConfig(
  providerId: SupportedProvider,
  settings: { apiKey?: string; baseUrl?: string },
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

export function getAvailableProviders(): ProviderConfig[] {
  return Object.values(PROVIDER_CONFIGS);
}

export function getProviderConfig(providerId: SupportedProvider): ProviderConfig | null {
  return PROVIDER_CONFIGS[providerId] || null;
}

export function isProviderConfigured(
  providerId: SupportedProvider,
  userSettings: UserProviderSettings,
): boolean {
  const userConfig = userSettings[providerId];
  const providerConfig = PROVIDER_CONFIGS[providerId];

  if (!userConfig?.isEnabled) return false;

  if (providerConfig?.requiresApiKey && !userConfig.apiKey) {
    return false;
  }

  return true;
}

export function getModelIdentifier(providerId: SupportedProvider, modelId: string): string {
  return `${providerId}:${modelId}`;
}

/** Providers that would be registered from current settings (for error messages). */
export function listEnabledRegistryProviders(
  userSettings: UserProviderSettings,
): string[] {
  const ids: string[] = [];
  if (userSettings.openai?.isEnabled && userSettings.openai?.apiKey) ids.push('openai');
  if (userSettings.google?.isEnabled && userSettings.google?.apiKey) ids.push('google');
  if (userSettings.openrouter?.isEnabled && userSettings.openrouter?.apiKey) ids.push('openrouter');
  if (userSettings.ollama?.isEnabled) ids.push('ollama');
  if (userSettings.vllm?.isEnabled) ids.push('vllm');
  return ids;
}
