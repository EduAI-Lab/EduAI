/**
 * AI Provider Registry for EduAI
 * Dynamic provider management with user-provided API keys
 */

import { createProviderRegistry } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOllama } from 'ollama-ai-provider';
import { cmps01InternalAuthHeadersForUrl } from '~/lib/ai/cmps01-internal-auth.server';
import { resolveAllowedOllamaBaseUrl } from '~/lib/ai/ollama-url.server';
import { resolveVllmApiKey } from '~/lib/ai/vllm-api-key.server';
import { resolveAllowedVllmBaseUrl } from '~/lib/ai/vllm-url.server';
import { vllmThinkingDisabledFetch } from '~/lib/ai/vllm-thinking.server';
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

/**
 * Resolves a local-inference base URL (Ollama/vLLM) with logging instead of
 * throwing: a rejected client-supplied host falls back to the deployment
 * default (logged, not silent, so a misconfig doesn't quietly hit the wrong
 * host); if the deployment default is itself misconfigured, the provider is
 * disabled (returns null) rather than the exception crashing registry
 * creation for every other provider.
 */
function resolveLocalInferenceBaseUrlOrLog(opts: {
  resolve: (raw?: string | null) => string;
  clientBaseUrl: string | undefined;
  providerLabel: string;
  envVarName: string;
}): string | null {
  const { resolve, clientBaseUrl, providerLabel, envVarName } = opts;
  try {
    return resolve(clientBaseUrl);
  } catch (error) {
    if (clientBaseUrl) {
      console.error(
        `[ai/providers] Rejected client-supplied ${providerLabel} base URL "${clientBaseUrl}": ` +
          `${error instanceof Error ? error.message : error}. Falling back to the deployment default.`,
      );
    }
  }

  try {
    return resolve();
  } catch (error) {
    console.error(
      `[ai/providers] ${envVarName} is misconfigured; disabling the ${providerLabel} provider: ` +
        `${error instanceof Error ? error.message : error}`,
    );
    return null;
  }
}

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
    const clientOllamaBaseUrl = userSettings.ollama?.baseUrl?.trim();
    // SSRF guard: only loopback or the deployment-configured OLLAMA_BASE_URL host
    // is trusted. Falls back to the deployment default when the client-supplied
    // host is rejected; if OLLAMA_BASE_URL itself is misconfigured, the fallback
    // is guarded too so a bad env var disables only this provider, not the
    // whole registry.
    let baseURL = resolveLocalInferenceBaseUrlOrLog({
      resolve: resolveAllowedOllamaBaseUrl,
      clientBaseUrl: clientOllamaBaseUrl,
      providerLabel: "Ollama",
      envVarName: "OLLAMA_BASE_URL",
    });

    if (baseURL) {
      // Ensure the URL ends with /api for Ollama compatibility
      if (!baseURL.endsWith("/api")) {
        baseURL = baseURL.replace(/\/$/, "") + "/api";
      }

      providers.ollama = createOllama({
        baseURL,
        // Never attach cmps01 internal key for client-supplied base URLs (IP allowlist bypass).
        headers: clientOllamaBaseUrl
          ? {}
          : cmps01InternalAuthHeadersForUrl(baseURL),
      });
    }
  }

  // vLLM (OpenAI-compatible /v1 — see docs/rag-ai/VLLM.md)
  if (userSettings.vllm?.isEnabled) {
    const clientVllmBaseUrl = userSettings.vllm?.baseUrl?.trim();
    // SSRF guard: only loopback or a deployment-configured VLLM host (VLLM_BASE_URL /
    // VLLM_FLEET_*) is trusted. See the Ollama block above for the fallback/logging shape.
    let baseURL = resolveLocalInferenceBaseUrlOrLog({
      resolve: resolveAllowedVllmBaseUrl,
      clientBaseUrl: clientVllmBaseUrl,
      providerLabel: "vLLM",
      envVarName: "VLLM_BASE_URL",
    });

    if (baseURL) {
      baseURL = baseURL.replace(/\/$/, '');
      if (!baseURL.endsWith('/v1')) {
        baseURL = `${baseURL}/v1`;
      }

      const apiKey = userSettings.vllm?.apiKey || resolveVllmApiKey();
      if (apiKey) {
        providers.vllm = createOpenAI({
          apiKey,
          baseURL,
          // Required for streamText usage on OpenAI-compatible backends (vLLM/LiteLLM).
          compatibility: "strict",
          fetch: vllmThinkingDisabledFetch(),
        });
      }
    }
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

/** Providers that would be registered from current settings (for error messages). */
export function listEnabledRegistryProviders(
  userSettings: UserProviderSettings,
): string[] {
  const ids: string[] = [];
  if (userSettings.openai?.isEnabled && userSettings.openai?.apiKey) ids.push('openai');
  if (userSettings.google?.isEnabled && userSettings.google?.apiKey) ids.push('google');
  if (userSettings.ollama?.isEnabled) ids.push('ollama');
  if (userSettings.vllm?.isEnabled && (userSettings.vllm?.apiKey || resolveVllmApiKey())) ids.push('vllm');
  return ids;
}

