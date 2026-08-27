/**
 * AI Provider Registry for EduAI
 * Dynamic provider management with user-provided API keys
 */

import type { ValidationResult } from "~/lib/validation-result";
import type { ProviderV1 } from "@ai-sdk/provider";
import { createProviderRegistry } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOllama } from "ollama-ai-provider";
import { cmps01InternalAuthHeadersForUrl } from "~/lib/ai/cmps01-internal-auth.server";
import { redactProviderUrlForLog } from "~/lib/ai/local-inference-url.server";
import { resolveAllowedOllamaBaseUrl } from "~/lib/ai/ollama-url.server";
import { resolveVllmApiKey } from "~/lib/ai/vllm-api-key.server";
import { resolveAllowedVllmBaseUrl } from "~/lib/ai/vllm-url.server";
import { vllmThinkingDisabledFetch } from "~/lib/ai/vllm-thinking.server";
import { createBedrockProvider } from "~/lib/ai/routing/bedrock/bedrock-provider.server";
import { getBedrockRegion } from "~/lib/ai/routing/bedrock/overflow.server";
import {
  LOCAL_INFERENCE_PROVIDERS,
  isDeploymentManagedProviderSettings,
  mergeLocalInferenceFromEnv,
  parseModelIdentifier,
  PROVIDER_CONFIGS,
  type ProviderConfig,
  type SupportedProvider,
  type UserProviderSettings,
} from "./provider-types";

export type { ProviderConfig, SupportedProvider, UserProviderSettings };
export {
  LOCAL_INFERENCE_PROVIDERS,
  mergeLocalInferenceFromEnv,
  parseModelIdentifier,
  PROVIDER_CONFIGS,
};

/** OpenCode's hosted OpenAI-compatible endpoint; never client-configurable. */
export const OPENCODE_BASE_URL = "https://opencode.ai/zen/go/v1";

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
        `[ai/providers] Rejected client-supplied ${providerLabel} base URL "${redactProviderUrlForLog(clientBaseUrl)}": ` +
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
 * The exact vLLM registration the registry would build from these settings, or
 * null when vLLM is not eligible. Provider *availability*
 * (`listEnabledRegistryProviders`) and the registry itself MUST agree on this
 * (#1568 review): otherwise the chat preflight can report vLLM available and
 * then fail at `registry.languageModel("vllm:…")`. Ineligible when the base URL
 * cannot be resolved — a client-supplied host rejected by the SSRF guard, or a
 * misconfigured `VLLM_BASE_URL` — or when no key is available to authenticate.
 */
function resolveVllmRegistration(
  userSettings: UserProviderSettings,
): { baseURL: string; apiKey: string } | null {
  if (!userSettings.vllm?.isEnabled) return null;
  const clientVllmBaseUrl = userSettings.vllm?.baseUrl?.trim();
  const clientVllmUrlSupplied =
    Boolean(clientVllmBaseUrl) && !isDeploymentManagedProviderSettings(userSettings.vllm);
  // SSRF guard: only an exact deployment-owned base (or explicit development/test loopback)
  // is trusted. See the Ollama block for the fallback/logging shape.
  let baseURL = resolveLocalInferenceBaseUrlOrLog({
    resolve: resolveAllowedVllmBaseUrl,
    clientBaseUrl: clientVllmBaseUrl,
    providerLabel: "vLLM",
    envVarName: "VLLM_BASE_URL",
  });
  if (!baseURL) return null;
  baseURL = baseURL.replace(/\/$/, "");
  if (!baseURL.endsWith("/v1")) {
    baseURL = `${baseURL}/v1`;
  }
  const apiKey =
    userSettings.vllm?.apiKey || (clientVllmUrlSupplied ? "vllm-local" : resolveVllmApiKey());
  if (!apiKey) return null;
  return { baseURL, apiKey };
}

/**
 * Creates a dynamic provider registry with user-provided settings
 */
export function createAIProviderRegistry(userSettings: UserProviderSettings) {
  // Keyed by `SupportedProvider`, but declared open: every entry is conditional
  // — a provider that is disabled, missing its key, or whose base URL failed to
  // resolve is simply absent — and the registry's model ids are built from
  // strings, so narrowing the key type here only moves the looseness to the
  // call sites.
  const providers: Record<string, ProviderV1> = {};

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
    const clientOllamaUrlSupplied =
      Boolean(clientOllamaBaseUrl) && !isDeploymentManagedProviderSettings(userSettings.ollama);
    // SSRF guard: only an exact deployment-owned base (or explicit development/test loopback)
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
        headers: clientOllamaUrlSupplied ? {} : cmps01InternalAuthHeadersForUrl(baseURL),
      });
    }
  }

  // vLLM (OpenAI-compatible /v1 — see docs/rag-ai/VLLM.md). Eligibility is shared
  // with listEnabledRegistryProviders via resolveVllmRegistration so preflight
  // and the registry never disagree (#1568 review).
  const vllmRegistration = resolveVllmRegistration(userSettings);
  if (vllmRegistration) {
    const vllm = createOpenAI({
      apiKey: vllmRegistration.apiKey,
      baseURL: vllmRegistration.baseURL,
      // Required for streamText usage on OpenAI-compatible backends (vLLM/LiteLLM).
      compatibility: "strict",
      fetch: vllmThinkingDisabledFetch(),
    });
    // `structuredOutputs` belongs to the language-model settings, not the
    // createOpenAI provider settings. Without this wrapper the SDK silently
    // downgrades a JSON-schema response format to ordinary Markdown, which
    // lets 2B/9B omit Assist stages or the diagram payload.
    providers.vllm = Object.assign(
      (modelId: string, settings?: Record<string, unknown>) =>
        vllm(modelId, { ...settings, structuredOutputs: true }),
      vllm,
      {
        languageModel: (modelId: string, settings?: Record<string, unknown>) =>
          vllm.languageModel(modelId, {
            ...settings,
            structuredOutputs: true,
          }),
        chat: (modelId: string, settings?: Record<string, unknown>) =>
          vllm.chat(modelId, { ...settings, structuredOutputs: true }),
      },
    );
  }

  // OpenCode Zen (OpenAI-compatible). Keep the endpoint fixed: unlike local
  // inference providers, accepting a request-supplied base URL would permit an
  // arbitrary upstream and make the provider identity misleading.
  if (userSettings.opencode?.isEnabled && userSettings.opencode?.apiKey) {
    providers.opencode = createOpenAICompatible({
      name: "opencode",
      baseURL: OPENCODE_BASE_URL,
      apiKey: userSettings.opencode.apiKey,
    });
  }

  // Bedrock is overflow-only (#1441). Never honor client apiKey/baseUrl —
  // the bearer token and region always come from server env.
  const bedrockToken = process.env.AWS_BEARER_TOKEN_BEDROCK?.trim();
  if (userSettings.bedrock?.isEnabled && bedrockToken) {
    providers.bedrock = createBedrockProvider({
      apiKey: bedrockToken,
      region: getBedrockRegion(),
    });
  }

  // Create and return the registry
  return createProviderRegistry(providers, { separator: ":" });
}

/**
 * Validates provider configuration
 */
export function validateProviderConfig(
  providerId: SupportedProvider,
  settings: { apiKey?: string; baseUrl?: string },
): ValidationResult {
  const config = PROVIDER_CONFIGS[providerId];

  if (!config) {
    return { isValid: false, error: "Unsupported provider" };
  }

  if (config.requiresApiKey && !settings.apiKey) {
    return { isValid: false, error: "API key is required for this provider" };
  }

  return { isValid: true };
}

/**
 * Get available provider configurations
 */
export function getAvailableProviders(): ProviderConfig[] {
  // Bedrock is overflow-only and must not appear in user-facing provider lists.
  return Object.values(PROVIDER_CONFIGS).filter((config) => config.id !== "bedrock");
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
  userSettings: UserProviderSettings,
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
export function listEnabledRegistryProviders(userSettings: UserProviderSettings): string[] {
  const ids: string[] = [];
  if (userSettings.openai?.isEnabled && userSettings.openai?.apiKey) ids.push("openai");
  if (userSettings.google?.isEnabled && userSettings.google?.apiKey) ids.push("google");
  if (userSettings.ollama?.isEnabled) ids.push("ollama");
  // Same eligibility rule as the registry — a resolvable base URL AND a key —
  // so preflight never advertises vLLM that languageModel() would reject (#1568).
  if (resolveVllmRegistration(userSettings)) ids.push("vllm");
  if (userSettings.opencode?.isEnabled && userSettings.opencode?.apiKey) ids.push("opencode");
  if (userSettings.bedrock?.isEnabled && process.env.AWS_BEARER_TOKEN_BEDROCK?.trim()) {
    ids.push("bedrock");
  }
  return ids;
}
