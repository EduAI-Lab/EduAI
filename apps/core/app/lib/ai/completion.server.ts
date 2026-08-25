/**
 * Stateless LLM completion for extension AI-assist flows (#858).
 * No chat persistence, RAG, tools, or course-chat default prompts.
 */

import type { JsonValue } from "~/lib/json-value";
import { streamText } from "ai";
import {
  createAIProviderRegistry,
  mergeLocalInferenceFromEnv,
  parseModelIdentifier,
  PROVIDER_CONFIGS,
} from "~/lib/ai/providers";
import { resolveActiveChatModel } from "~/lib/ai/providers.server";
import {
  classifyProviderFailure,
  createProviderFailure,
  providerErrorDiagnostic,
} from "~/lib/ai/provider-errors.server";
import { FleetUnavailableError, resolveFleetHost } from "~/lib/ai/routing/fleet/resolve-fleet";
import { fleetRoutingEnabled } from "~/lib/ai/routing/fleet/registry";
import { parseJobType } from "~/lib/ai/routing/fleet/types";
import { composeSecurityPrompt, sanitizeSystemPrompt } from "~/lib/ai/prompt-safety";
import type { UserProviderSettings } from "~/lib/ai/provider-types";
import { clientApiKeysBodySchema, toUserProviderSettings } from "~/lib/chat-api-keys.schema";

const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 8192;
const MAX_COMPLETION_TOKENS = 16_384;
const COMPLETION_MESSAGE_ROLES = new Set(["system", "user", "assistant"]);

export const COMPLETION_MAX_BODY_BYTES_DEFAULT = 2 * 1024 * 1024;
export const COMPLETION_MAX_MESSAGES_DEFAULT = 100;
export const COMPLETION_MAX_MESSAGE_CHARS_DEFAULT = 32_768;
export const COMPLETION_MAX_TOTAL_MESSAGE_CHARS_DEFAULT = 131_072;
export const COMPLETION_MAX_SYSTEM_PROMPT_CHARS_DEFAULT = 32_768;
export const COMPLETION_MAX_API_KEY_CHARS_DEFAULT = 16_384;
export const COMPLETION_MAX_BASE_URL_CHARS_DEFAULT = 2_048;
export const COMPLETION_MAX_MODEL_CHARS_DEFAULT = 512;
export const COMPLETION_MIN_TEMPERATURE = 0;
export const COMPLETION_MAX_TEMPERATURE = 2;

export type CompletionInputLimits = {
  maxBodyBytes: number;
  maxMessages: number;
  maxMessageChars: number;
  maxTotalMessageChars: number;
  maxSystemPromptChars: number;
  maxApiKeyChars: number;
  maxBaseUrlChars: number;
  maxModelChars: number;
};

export type CompletionInputLimitOverrides = Partial<CompletionInputLimits>;

export type CompletionValidationResult =
  | { ok: true; request: CompletionRequest }
  | { ok: false; status: 400 | 422; error: string };

function positiveEnvInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveCompletionInputLimits(
  overrides: CompletionInputLimitOverrides = {},
): CompletionInputLimits {
  const fromEnv = (name: string, fallback: number, explicit?: number) => {
    if (explicit !== undefined) {
      return Number.isSafeInteger(explicit) && explicit > 0 ? explicit : fallback;
    }
    return positiveEnvInt(name, fallback);
  };

  return {
    maxBodyBytes: fromEnv(
      "COMPLETION_MAX_BODY_BYTES",
      COMPLETION_MAX_BODY_BYTES_DEFAULT,
      overrides.maxBodyBytes,
    ),
    maxMessages: fromEnv(
      "COMPLETION_MAX_MESSAGES",
      COMPLETION_MAX_MESSAGES_DEFAULT,
      overrides.maxMessages,
    ),
    maxMessageChars: fromEnv(
      "COMPLETION_MAX_MESSAGE_CHARS",
      COMPLETION_MAX_MESSAGE_CHARS_DEFAULT,
      overrides.maxMessageChars,
    ),
    maxTotalMessageChars: fromEnv(
      "COMPLETION_MAX_TOTAL_MESSAGE_CHARS",
      COMPLETION_MAX_TOTAL_MESSAGE_CHARS_DEFAULT,
      overrides.maxTotalMessageChars,
    ),
    maxSystemPromptChars: fromEnv(
      "COMPLETION_MAX_SYSTEM_PROMPT_CHARS",
      COMPLETION_MAX_SYSTEM_PROMPT_CHARS_DEFAULT,
      overrides.maxSystemPromptChars,
    ),
    maxApiKeyChars: fromEnv(
      "COMPLETION_MAX_API_KEY_CHARS",
      COMPLETION_MAX_API_KEY_CHARS_DEFAULT,
      overrides.maxApiKeyChars,
    ),
    maxBaseUrlChars: fromEnv(
      "COMPLETION_MAX_BASE_URL_CHARS",
      COMPLETION_MAX_BASE_URL_CHARS_DEFAULT,
      overrides.maxBaseUrlChars,
    ),
    maxModelChars: fromEnv(
      "COMPLETION_MAX_MODEL_CHARS",
      COMPLETION_MAX_MODEL_CHARS_DEFAULT,
      overrides.maxModelChars,
    ),
  };
}

export type CompletionMessage = {
  id?: string;
  role: string;
  /** Either a plain string or the AI-SDK parts array; both arrive as JSON. */
  content: JsonValue;
};

/**
 * Per-provider credentials the caller supplied. Keyed by provider id, and each
 * entry is validated field by field before any of it reaches a provider.
 */
export type CompletionApiKeys = {
  [providerId: string]: { apiKey?: string; baseUrl?: string } | undefined;
};

export type CompletionRequest = {
  model: string;
  apiKeys: CompletionApiKeys;
  systemPrompt?: string | null;
  messages?: CompletionMessage[];
  streaming?: boolean;
  temperature?: number;
  maxTokens?: number;
  routingContext?: JsonValue;
  /** Client disconnect / Stop — forwarded to streamText so provider generation aborts. */
  signal?: AbortSignal;
};

function completionValidationError(status: 400 | 422, error: string): CompletionValidationResult {
  return { ok: false, status, error };
}

function serializedContentChars(content: JsonValue | undefined): number | null {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return null;
  try {
    const serialized = JSON.stringify(content);
    return typeof serialized === "string" ? serialized.length : null;
  } catch {
    return null;
  }
}

function validateApiKeys(
  value: JsonValue | undefined,
  limits: CompletionInputLimits,
): CompletionValidationResult | null {
  if (value === undefined) {
    return completionValidationError(400, "Invalid apiKeys");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return completionValidationError(422, "apiKeys must be an object");
  }

  for (const [providerId, providerValue] of Object.entries(value)) {
    if (providerId.length > limits.maxModelChars) {
      return completionValidationError(422, "apiKeys provider id exceeds maximum length");
    }
    if (!providerValue || typeof providerValue !== "object" || Array.isArray(providerValue)) {
      return completionValidationError(422, `apiKeys.${providerId} must be an object`);
    }

    const entry = providerValue;
    if (entry.apiKey !== undefined) {
      if (typeof entry.apiKey !== "string") {
        return completionValidationError(422, `apiKeys.${providerId}.apiKey must be a string`);
      }
      if (entry.apiKey.length > limits.maxApiKeyChars) {
        return completionValidationError(422, "apiKey exceeds maximum length");
      }
    }
    if (entry.baseUrl !== undefined) {
      if (typeof entry.baseUrl !== "string") {
        return completionValidationError(422, `apiKeys.${providerId}.baseUrl must be a string`);
      }
      if (entry.baseUrl.length > limits.maxBaseUrlChars) {
        return completionValidationError(422, "baseUrl exceeds maximum length");
      }
    }
  }

  if (!clientApiKeysBodySchema.safeParse(value).success) {
    return completionValidationError(400, "Invalid apiKeys");
  }

  return null;
}

/** Validate cheap, bounded completion input before admission or provider setup. */
export function validateCompletionRequest(
  input: JsonValue | undefined,
  overrides: CompletionInputLimitOverrides = {},
): CompletionValidationResult {
  const limits = resolveCompletionInputLimits(overrides);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return completionValidationError(400, "Invalid completion request body");
  }

  const body = input;
  if (typeof body.model !== "string" || body.model.trim().length === 0) {
    return completionValidationError(400, "model is required");
  }
  if (body.model.length > limits.maxModelChars) {
    return completionValidationError(422, "model exceeds maximum length");
  }

  if (body.systemPrompt !== undefined && body.systemPrompt !== null) {
    if (typeof body.systemPrompt !== "string") {
      return completionValidationError(422, "systemPrompt must be a string");
    }
    if (body.systemPrompt.length > limits.maxSystemPromptChars) {
      return completionValidationError(422, "systemPrompt exceeds maximum length");
    }
  }

  if (body.messages !== undefined && !Array.isArray(body.messages)) {
    return completionValidationError(422, "messages must be an array");
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length > limits.maxMessages) {
    return completionValidationError(422, "messages exceeds maximum count");
  }

  let totalMessageChars = 0;
  for (const message of messages) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return completionValidationError(422, "each message must be an object");
    }
    const candidate = message;
    if (typeof candidate.role !== "string") {
      return completionValidationError(422, "each message role must be a string");
    }
    if (!COMPLETION_MESSAGE_ROLES.has(candidate.role)) {
      return completionValidationError(422, `Unsupported message role: ${candidate.role}`);
    }
    const contentChars = serializedContentChars(candidate.content);
    if (contentChars === null) {
      return completionValidationError(422, "each message content must be a string or parts array");
    }
    if (contentChars > limits.maxMessageChars) {
      return completionValidationError(422, "message content exceeds maximum length");
    }
    totalMessageChars += contentChars;
    if (totalMessageChars > limits.maxTotalMessageChars) {
      return completionValidationError(422, "messages exceed aggregate character limit");
    }
  }

  const apiKeysError = validateApiKeys(body.apiKeys, limits);
  if (apiKeysError) return apiKeysError;
  // SAFETY: `validateApiKeys` returned no error, so `apiKeys` is an object of
  // per-provider entries with only the two optional string fields.
  const apiKeys = (body.apiKeys ?? {}) as CompletionApiKeys;

  if (body.temperature !== undefined) {
    if (
      typeof body.temperature !== "number" ||
      !Number.isFinite(body.temperature) ||
      body.temperature < COMPLETION_MIN_TEMPERATURE ||
      body.temperature > COMPLETION_MAX_TEMPERATURE
    ) {
      return completionValidationError(
        422,
        `temperature must be between ${COMPLETION_MIN_TEMPERATURE} and ${COMPLETION_MAX_TEMPERATURE}`,
      );
    }
  }

  if (body.maxTokens !== undefined) {
    if (
      typeof body.maxTokens !== "number" ||
      !Number.isInteger(body.maxTokens) ||
      body.maxTokens < 1 ||
      body.maxTokens > MAX_COMPLETION_TOKENS
    ) {
      return completionValidationError(
        400,
        `maxTokens must be between 1 and ${MAX_COMPLETION_TOKENS}`,
      );
    }
  }

  if (body.streaming !== undefined && typeof body.streaming !== "boolean") {
    return completionValidationError(422, "streaming must be a boolean");
  }

  return {
    ok: true,
    request: {
      model: body.model,
      apiKeys,
      // SAFETY: every field below was checked by the walk above — this is
      // where those checks are cashed in, not where they are assumed.
      systemPrompt: body.systemPrompt as string | null | undefined,
      messages: messages as CompletionMessage[],
      streaming: body.streaming as boolean | undefined,
      temperature: body.temperature as number | undefined,
      maxTokens: body.maxTokens as number | undefined,
      routingContext: body.routingContext,
    },
  };
}

export type ResolvedCompletionPrompt = {
  system: string;
  messages: CompletionMessage[];
};

export type CompletionModelPolicyResult =
  | {
      ok: true;
      modelId: string;
      parsedModel: NonNullable<ReturnType<typeof parseModelIdentifier>>;
    }
  | { ok: false; status: 400 | 422 | 503; error: string };

/** Resolve concrete completion models through the active Core catalog. */
export async function resolveCompletionModelPolicy(
  modelIdentifier: string,
): Promise<CompletionModelPolicyResult> {
  const parsedModel = parseModelIdentifier(modelIdentifier);
  if (!parsedModel) {
    return {
      ok: false,
      status: 400,
      error: "Invalid model id. Use provider:modelId (e.g. google:gemini-2.5-flash).",
    };
  }

  try {
    const activeModel = await resolveActiveChatModel(modelIdentifier);
    if (!activeModel) {
      return {
        ok: false,
        status: 422,
        error: `Model "${modelIdentifier}" is not active in the Core model catalog`,
      };
    }
  } catch {
    return {
      ok: false,
      status: 503,
      error: "Core model catalog is unavailable",
    };
  }

  return { ok: true, modelId: modelIdentifier, parsedModel };
}

/**
 * Resolves system prompt from body.systemPrompt or the first system message.
 * Remaining messages must be user/assistant only.
 */
export function resolveCompletionPrompt(
  body: Pick<CompletionRequest, "systemPrompt" | "messages">,
): ResolvedCompletionPrompt | { error: string } {
  const rawMessages = Array.isArray(body.messages) ? body.messages : [];

  let systemFromBody: string | null = null;
  if (typeof body.systemPrompt === "string") {
    systemFromBody = sanitizeSystemPrompt(body.systemPrompt);
  } else if (body.systemPrompt === null) {
    systemFromBody = null;
  }

  let systemFromMessage: string | null = null;
  const conversationMessages: CompletionMessage[] = [];

  for (const message of rawMessages) {
    if (!message || typeof message !== "object" || typeof message.role !== "string") {
      continue;
    }
    if (message.role === "system") {
      if (!systemFromMessage && typeof message.content === "string") {
        systemFromMessage = sanitizeSystemPrompt(message.content);
      }
      continue;
    }
    if (message.role === "user" || message.role === "assistant") {
      conversationMessages.push(message);
      continue;
    }
    return { error: `Unsupported message role: ${message.role}` };
  }

  // Truthy fallback — empty/whitespace body.systemPrompt must not block a real
  // system message (sanitize usually nulls empties; `||` keeps the contract tight).
  const baseSystem = systemFromBody || systemFromMessage;
  if (!baseSystem) {
    return { error: "systemPrompt is required (body field or one system message)" };
  }

  if (conversationMessages.length === 0) {
    return { error: "At least one user or assistant message is required" };
  }

  return {
    system: composeSecurityPrompt(baseSystem),
    messages: conversationMessages,
  };
}

/**
 * Ordered BYOK fallback models used when the UBC vLLM fleet is unavailable
 * (#1645). Only BYOK providers belong here — the point is to use the caller's
 * own key when server-hosted inference cannot serve the request. Override with
 * `COMPLETION_FLEET_FALLBACK_MODELS` (comma-separated `provider:model` in
 * preference order).
 */
export const DEFAULT_FLEET_FALLBACK_MODELS = "openai:gpt-4o-mini,google:gemini-2.5-flash";

/**
 * Pick the first fallback model, in configured preference order, that is usable
 * right now: its BYOK provider must be keyed AND enabled AND its `provider:model`
 * id must resolve to an active Core catalog row (`resolveCompletionModelPolicy`).
 * Returns that model's policy result so the caller reuses the parsed model, or
 * null when no candidate qualifies — in which case the fleet outage stays a hard
 * failure.
 *
 * Skipping earlier candidates that fail these checks is deliberate (#1645
 * review): an earlier keyed-but-policy-failing (or disabled) candidate must not
 * abandon a usable later one. A candidate that is keyed+enabled but whose
 * catalog row is missing/inactive is logged as a warn breadcrumb (no secrets)
 * so the otherwise-silent dead-on-arrival case is visible in logs.
 */
export async function resolveFleetFallbackModel(
  userSettings: UserProviderSettings,
): Promise<Extract<CompletionModelPolicyResult, { ok: true }> | null> {
  const configured = process.env.COMPLETION_FLEET_FALLBACK_MODELS?.trim();
  const candidates = (configured || DEFAULT_FLEET_FALLBACK_MODELS)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const candidate of candidates) {
    const parsed = parseModelIdentifier(candidate);
    if (!parsed) continue;
    // Local/UBC-hosted providers are exactly what just failed — skip them.
    if (parsed.providerId === "vllm" || parsed.providerId === "ollama") continue;
    const settings = userSettings[parsed.providerId];
    // Require a held key AND an enabled provider. A disabled-but-keyed provider
    // would otherwise be chosen here and then rejected downstream with a
    // misleading INVALID_PROVIDER_CONFIG (#1645 review nit).
    if (!settings?.apiKey || !settings.apiKey.trim() || !settings.isEnabled) continue;
    const policy = await resolveCompletionModelPolicy(candidate);
    if (policy.ok) return policy;
    // Keyed + enabled but the catalog has no active row for it: this fallback is
    // dead on arrival. Surface it (no secrets) and try the next ordered candidate.
    console.warn("[completion] fleet fallback candidate unavailable in catalog", {
      candidate,
      providerId: parsed.providerId,
      status: policy.status,
    });
  }
  return null;
}

export async function runCompletion(request: CompletionRequest) {
  // The abort signal is the one field that is not JSON; the bounds checks below
  // only look at the payload, so validate the request without it.
  const { signal: _signal, ...jsonRequest } = request;
  const validation = validateCompletionRequest(jsonRequest);
  if (!validation.ok) {
    return {
      ok: false as const,
      status: validation.status,
      error: validation.error,
    };
  }

  const modelPolicy = await resolveCompletionModelPolicy(request.model);
  if (!modelPolicy.ok) {
    return modelPolicy;
  }

  const resolved = resolveCompletionPrompt(request);
  if ("error" in resolved) {
    return { ok: false as const, status: 400, error: resolved.error };
  }

  if (!request.model?.trim()) {
    return { ok: false as const, status: 400, error: "model is required" };
  }

  if (
    request.maxTokens !== undefined &&
    (!Number.isFinite(request.maxTokens) ||
      !Number.isInteger(request.maxTokens) ||
      request.maxTokens < 1 ||
      request.maxTokens > MAX_COMPLETION_TOKENS)
  ) {
    return {
      ok: false as const,
      status: 400,
      error: `maxTokens must be between 1 and ${MAX_COMPLETION_TOKENS}`,
    };
  }

  const apiKeysParsed = clientApiKeysBodySchema.safeParse(request.apiKeys);
  if (!apiKeysParsed.success) {
    return {
      ok: false as const,
      status: 400,
      error: "Invalid apiKeys",
    };
  }

  // Built before fleet resolution so a fleet outage can consult the caller's
  // BYOK keys for a fallback provider (#1645).
  const userProviderSettings = toUserProviderSettings(apiKeysParsed.data);

  let parsedModel = modelPolicy.parsedModel;
  let validatedModelId =
    `${parsedModel.providerId}:${parsedModel.modelId}` as `${string}:${string}`;
  let fleetBaseUrl: string | undefined;
  let fleetServerId: string | undefined;
  if (parsedModel.providerId === "vllm" && fleetRoutingEnabled()) {
    try {
      const fleetPick = await resolveFleetHost({
        jobType: parseJobType(request.routingContext),
        resolvedModelId: validatedModelId,
      });
      fleetBaseUrl = fleetPick?.baseUrl;
      fleetServerId = fleetPick?.serverId;
    } catch (error) {
      if (!(error instanceof FleetUnavailableError)) throw error;
      // #1645: the UBC fleet is down. Before hard-failing, fall back to the first
      // BYOK provider (in configured order) the caller keyed+enabled AND that has
      // an active Core catalog row. If none qualifies, keep MODEL_UNAVAILABLE.
      const fallbackPolicy = await resolveFleetFallbackModel(userProviderSettings);
      if (!fallbackPolicy) {
        return createProviderFailure(parsedModel.providerId, "MODEL_UNAVAILABLE");
      }
      parsedModel = fallbackPolicy.parsedModel;
      validatedModelId =
        `${parsedModel.providerId}:${parsedModel.modelId}` as `${string}:${string}`;
      // A BYOK provider needs no fleet host; leave fleetBaseUrl/fleetServerId unset.
    }
  }

  const validatedApiKeys = mergeLocalInferenceFromEnv(
    userProviderSettings,
    validatedModelId,
    fleetBaseUrl,
  );

  const providerSettings = validatedApiKeys[parsedModel.providerId];
  if (!providerSettings?.isEnabled) {
    return createProviderFailure(parsedModel.providerId, "INVALID_PROVIDER_CONFIG");
  }
  if (PROVIDER_CONFIGS[parsedModel.providerId]?.requiresApiKey && !providerSettings.apiKey) {
    return createProviderFailure(parsedModel.providerId, "INVALID_PROVIDER_CONFIG");
  }

  let aiModel;
  try {
    const registry = createAIProviderRegistry(validatedApiKeys);
    aiModel = registry.languageModel(validatedModelId);
  } catch (error) {
    // languageModel() can throw before streamText when the selected provider
    // was not registered. Normalize it so SDK details and credentials cannot
    // escape through the public completion contract.
    console.error("[completion] provider setup failed", {
      model: validatedModelId,
      providerId: parsedModel.providerId,
      diagnostic: providerErrorDiagnostic(error),
    });
    return classifyProviderFailure(parsedModel.providerId, error);
  }

  const streaming = request.streaming === true;
  const temperature =
    typeof request.temperature === "number" && Number.isFinite(request.temperature)
      ? request.temperature
      : DEFAULT_TEMPERATURE;
  const maxTokens = typeof request.maxTokens === "number" ? request.maxTokens : DEFAULT_MAX_TOKENS;

  let result;
  try {
    result = await streamText({
      model: aiModel,
      system: resolved.system,
      messages: resolved.messages as Parameters<typeof streamText>[0]["messages"],
      temperature,
      maxTokens,
      abortSignal: request.signal,
      onError: ({ error }) => {
        console.error("[completion] provider stream error", {
          model: validatedModelId,
          providerId: parsedModel.providerId,
          diagnostic: providerErrorDiagnostic(error),
        });
      },
    });
  } catch (error) {
    console.error("[completion] provider stream failed", {
      model: validatedModelId,
      providerId: parsedModel.providerId,
      diagnostic: providerErrorDiagnostic(error),
    });
    return classifyProviderFailure(parsedModel.providerId, error);
  }

  if (streaming) {
    return {
      ok: true as const,
      streaming: true as const,
      result,
      fleetServerId,
      // Exposed so the route can classify a late stream error without parsing
      // the model identifier again.
      provider: parsedModel.providerId,
    };
  }

  try {
    await result.consumeStream();
    const [text, usage, finishReason] = await Promise.all([
      result.text,
      result.usage,
      result.finishReason,
    ]);

    return {
      ok: true as const,
      streaming: false as const,
      fleetServerId,
      body: {
        content: text,
        model: validatedModelId,
        usage,
        finishReason,
      },
      // Server-only routing metadata. API routes serialize `body` only.
      internal: {
        fleetHost: fleetBaseUrl ?? null,
        fleetServerId: fleetServerId ?? null,
      },
    };
  } catch (error) {
    console.error("[completion] provider stream failed", {
      model: validatedModelId,
      providerId: parsedModel.providerId,
      diagnostic: providerErrorDiagnostic(error),
    });
    return classifyProviderFailure(parsedModel.providerId, error);
  }
}
