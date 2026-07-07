/**
 * Stateless LLM completion for extension AI-assist flows (#858).
 * No chat persistence, RAG, tools, or course-chat default prompts.
 */

import { streamText } from "ai";
import {
  createAIProviderRegistry,
  mergeLocalInferenceFromEnv,
  parseModelIdentifier,
} from "~/lib/ai/providers";
import {
  composeSecurityPrompt,
  sanitizeSystemPrompt,
} from "~/lib/ai/prompt-safety";
import { clientApiKeysBodySchema, toUserProviderSettings } from "~/lib/chat-api-keys.schema";

const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 8192;

export type CompletionMessage = {
  id?: string;
  role: string;
  content: unknown;
};

export type CompletionRequest = {
  model: string;
  apiKeys: unknown;
  systemPrompt?: string | null;
  messages?: CompletionMessage[];
  streaming?: boolean;
  temperature?: number;
  maxTokens?: number;
};

export type ResolvedCompletionPrompt = {
  system: string;
  messages: CompletionMessage[];
};

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

  const baseSystem = systemFromBody ?? systemFromMessage;
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
  const resolved = resolveCompletionPrompt(request);
  if ("error" in resolved) {
    return { ok: false as const, status: 400, error: resolved.error };
  }

  if (!request.model?.trim()) {
    return { ok: false as const, status: 400, error: "model is required" };
  }

  const apiKeysParsed = clientApiKeysBodySchema.safeParse(request.apiKeys);
  if (!apiKeysParsed.success) {
    return {
      ok: false as const,
      status: 400,
      error: "Invalid apiKeys",
    };
  }

  const parsedModel = parseModelIdentifier(request.model);
  if (!parsedModel) {
    return {
      ok: false as const,
      status: 400,
      error:
        'Invalid model id. Use provider:modelId (e.g. google:gemini-2.5-flash).',
    };
  }

  const validatedApiKeys = mergeLocalInferenceFromEnv(
    toUserProviderSettings(apiKeysParsed.data),
    request.model,
  );

  if (!validatedApiKeys[parsedModel.providerId]?.isEnabled) {
    return {
      ok: false as const,
      status: 400,
      error: `Provider "${parsedModel.providerId}" is not available`,
    };
  }

  const registry = createAIProviderRegistry(validatedApiKeys);
  const aiModel = registry.languageModel(request.model);
  const streaming = request.streaming === true;
  const temperature =
    typeof request.temperature === "number" && Number.isFinite(request.temperature)
      ? request.temperature
      : DEFAULT_TEMPERATURE;
  const maxTokens =
    typeof request.maxTokens === "number" && request.maxTokens > 0
      ? Math.floor(request.maxTokens)
      : DEFAULT_MAX_TOKENS;

  const result = await streamText({
    model: aiModel,
    system: resolved.system,
    messages: resolved.messages as Parameters<typeof streamText>[0]["messages"],
    temperature,
    maxTokens,
  });

  if (streaming) {
    return { ok: true as const, streaming: true as const, result };
  }

  await result.consumeStream();
  const [text, usage, finishReason] = await Promise.all([
    result.text,
    result.usage,
    result.finishReason,
  ]);

  return {
    ok: true as const,
    streaming: false as const,
    body: {
      content: text,
      model: request.model,
      usage,
      finishReason,
    },
  };
}
