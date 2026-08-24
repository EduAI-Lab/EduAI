/**
 * Stateless LLM completion for extension AI-assist flows (#858).
 * No chat persistence, RAG, tools, or course-chat default prompts.
 */

import type { JsonValue } from "~/lib/json-value";
import { z } from "zod";
import { jsonObjectSchema, jsonValueSchema } from "~/lib/json-value";
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

/**
 * A completion message as it arrives on the wire.
 *
 * `content` is either a plain string or the AI-SDK parts array. That union is
 * the contract, not a convenience: those are the two forms this route knows how
 * to size against the character limits and forward to a provider.
 */
const completionMessageSchema = z
  .object({
    id: z.string().optional(),
    role: z.string(),
    content: z.union([z.string(), z.array(jsonValueSchema)]),
  })
  // Whatever else the caller attached travels on to the provider untouched, but
  // it still has to be JSON: `runCompletion` re-validates the message it is
  // handed, and an unknown-valued key would not survive that round trip.
  .catchall(jsonValueSchema.optional());

export type CompletionMessage = z.infer<typeof completionMessageSchema>;

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

/**
 * How many characters a message costs against the size limits: a string costs
 * its own length, a parts array costs its serialised length. The content has
 * already been decoded into one of those two forms, so there is no third case.
 */
function serializedContentChars(content: CompletionMessage["content"]): number {
  const text = z.string().safeParse(content);
  return text.success ? text.data.length : JSON.stringify(content).length;
}

/** A per-provider credential entry, before its fields are measured. */
const apiKeyEntrySchema = z.object({}).passthrough();

/**
 * Either the decoded credentials or the rejection that stopped them, so the
 * caller reads the entries it was handed instead of re-asserting the input it
 * passed in.
 */
type ApiKeysDecodeResult =
  | { ok: true; apiKeys: CompletionApiKeys }
  | { ok: false; failure: CompletionValidationResult };

function decodeApiKeys(
  value: JsonValue | undefined,
  limits: CompletionInputLimits,
): ApiKeysDecodeResult {
  const rejected = (status: 400 | 422, error: string): ApiKeysDecodeResult => ({
    ok: false,
    failure: completionValidationError(status, error),
  });

  if (value === undefined) {
    return rejected(400, "Invalid apiKeys");
  }
  const envelope = jsonObjectSchema.safeParse(value);
  if (!envelope.success) {
    return rejected(422, "apiKeys must be an object");
  }

  for (const [providerId, providerValue] of Object.entries(envelope.data)) {
    if (providerId.length > limits.maxModelChars) {
      return rejected(422, "apiKeys provider id exceeds maximum length");
    }
    const entry = apiKeyEntrySchema.safeParse(providerValue);
    if (!entry.success) {
      return rejected(422, `apiKeys.${providerId} must be an object`);
    }

    const fields = entry.data;
    if (fields.apiKey !== undefined) {
      const apiKey = z.string().safeParse(fields.apiKey);
      if (!apiKey.success) {
        return rejected(422, `apiKeys.${providerId}.apiKey must be a string`);
      }
      if (apiKey.data.length > limits.maxApiKeyChars) {
        return rejected(422, "apiKey exceeds maximum length");
      }
    }
    if (fields.baseUrl !== undefined) {
      const baseUrl = z.string().safeParse(fields.baseUrl);
      if (!baseUrl.success) {
        return rejected(422, `apiKeys.${providerId}.baseUrl must be a string`);
      }
      if (baseUrl.data.length > limits.maxBaseUrlChars) {
        return rejected(422, "baseUrl exceeds maximum length");
      }
    }
  }

  const decoded = clientApiKeysBodySchema.safeParse(value);
  if (!decoded.success) {
    return rejected(400, "Invalid apiKeys");
  }

  return { ok: true, apiKeys: decoded.data };
}

/** Validate cheap, bounded completion input before admission or provider setup. */
export function validateCompletionRequest(
  input: JsonValue | undefined,
  overrides: CompletionInputLimitOverrides = {},
): CompletionValidationResult {
  const limits = resolveCompletionInputLimits(overrides);
  const bodyEnvelope = jsonObjectSchema.safeParse(input);
  if (!bodyEnvelope.success) {
    return completionValidationError(400, "Invalid completion request body");
  }
  const body = bodyEnvelope.data;

  const model = z.string().safeParse(body.model);
  if (!model.success || model.data.trim().length === 0) {
    return completionValidationError(400, "model is required");
  }
  if (model.data.length > limits.maxModelChars) {
    return completionValidationError(422, "model exceeds maximum length");
  }

  // An absent prompt and an explicit `null` both mean "no prompt", and callers
  // distinguish them, so only a present value is decoded and measured.
  let systemPrompt: string | null | undefined;
  if (body.systemPrompt === null) {
    systemPrompt = null;
  } else if (body.systemPrompt !== undefined) {
    const decoded = z.string().safeParse(body.systemPrompt);
    if (!decoded.success) {
      return completionValidationError(422, "systemPrompt must be a string");
    }
    if (decoded.data.length > limits.maxSystemPromptChars) {
      return completionValidationError(422, "systemPrompt exceeds maximum length");
    }
    systemPrompt = decoded.data;
  }

  let rawMessages: JsonValue[] = [];
  if (body.messages !== undefined) {
    const decoded = z.array(jsonValueSchema).safeParse(body.messages);
    if (!decoded.success) {
      return completionValidationError(422, "messages must be an array");
    }
    rawMessages = decoded.data;
  }
  if (rawMessages.length > limits.maxMessages) {
    return completionValidationError(422, "messages exceeds maximum count");
  }

  const messages: CompletionMessage[] = [];
  let totalMessageChars = 0;
  for (const raw of rawMessages) {
    const envelope = jsonObjectSchema.safeParse(raw);
    if (!envelope.success) {
      return completionValidationError(422, "each message must be an object");
    }
    const role = z.string().safeParse(envelope.data.role);
    if (!role.success) {
      return completionValidationError(422, "each message role must be a string");
    }
    if (!COMPLETION_MESSAGE_ROLES.has(role.data)) {
      return completionValidationError(422, `Unsupported message role: ${role.data}`);
    }
    // The envelope and the role are already decoded, so content is the only
    // field left that can fail here.
    const message = completionMessageSchema.safeParse(raw);
    if (!message.success) {
      return completionValidationError(422, "each message content must be a string or parts array");
    }

    const contentChars = serializedContentChars(message.data.content);
    if (contentChars > limits.maxMessageChars) {
      return completionValidationError(422, "message content exceeds maximum length");
    }
    totalMessageChars += contentChars;
    if (totalMessageChars > limits.maxTotalMessageChars) {
      return completionValidationError(422, "messages exceed aggregate character limit");
    }
    messages.push(message.data);
  }

  const decodedApiKeys = decodeApiKeys(body.apiKeys, limits);
  if (!decodedApiKeys.ok) return decodedApiKeys.failure;

  let temperature: number | undefined;
  if (body.temperature !== undefined) {
    const decoded = z
      .number()
      .finite()
      .min(COMPLETION_MIN_TEMPERATURE)
      .max(COMPLETION_MAX_TEMPERATURE)
      .safeParse(body.temperature);
    if (!decoded.success) {
      return completionValidationError(
        422,
        `temperature must be between ${COMPLETION_MIN_TEMPERATURE} and ${COMPLETION_MAX_TEMPERATURE}`,
      );
    }
    temperature = decoded.data;
  }

  let maxTokens: number | undefined;
  if (body.maxTokens !== undefined) {
    const decoded = z.number().int().min(1).max(MAX_COMPLETION_TOKENS).safeParse(body.maxTokens);
    if (!decoded.success) {
      return completionValidationError(
        400,
        `maxTokens must be between 1 and ${MAX_COMPLETION_TOKENS}`,
      );
    }
    maxTokens = decoded.data;
  }

  let streaming: boolean | undefined;
  if (body.streaming !== undefined) {
    const decoded = z.boolean().safeParse(body.streaming);
    if (!decoded.success) {
      return completionValidationError(422, "streaming must be a boolean");
    }
    streaming = decoded.data;
  }

  return {
    ok: true,
    request: {
      model: model.data,
      apiKeys: decodedApiKeys.apiKeys,
      systemPrompt,
      messages,
      streaming,
      temperature,
      maxTokens,
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
  if (body.systemPrompt !== undefined && body.systemPrompt !== null) {
    systemFromBody = sanitizeSystemPrompt(body.systemPrompt);
  }

  let systemFromMessage: string | null = null;
  const conversationMessages: CompletionMessage[] = [];

  for (const message of rawMessages) {
    if (message.role === "system") {
      // Only a plain-string system message is usable as a prompt; a parts array
      // is a conversation turn that happens to be labelled `system`.
      const text = z.string().safeParse(message.content);
      if (!systemFromMessage && text.success) {
        systemFromMessage = sanitizeSystemPrompt(text.data);
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

  const parsedModel = modelPolicy.parsedModel;
  const validatedModelId =
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
      if (error instanceof FleetUnavailableError) {
        return createProviderFailure(parsedModel.providerId, "MODEL_UNAVAILABLE");
      }
      throw error;
    }
  }

  const validatedApiKeys = mergeLocalInferenceFromEnv(
    toUserProviderSettings(apiKeysParsed.data),
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
  const temperature = request.temperature ?? DEFAULT_TEMPERATURE;
  const maxTokens = request.maxTokens ?? DEFAULT_MAX_TOKENS;

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
