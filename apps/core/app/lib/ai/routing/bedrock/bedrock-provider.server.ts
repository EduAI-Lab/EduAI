/**
 * Hand-rolled AI SDK v4 LanguageModelV1 for Amazon Bedrock Converse.
 *
 * Uses the bearer-token auth already proven in scripts/bedrock-llama3-smoke.mjs
 * (`Authorization: Bearer ${AWS_BEARER_TOKEN_BEDROCK}`). The official
 * `@ai-sdk/amazon-bedrock` bearer-token path requires ai@5, which this repo
 * does not pin.
 */

import type {
  LanguageModelV1,
  LanguageModelV1CallOptions,
  LanguageModelV1CallWarning,
  LanguageModelV1FinishReason,
  LanguageModelV1Prompt,
  LanguageModelV1StreamPart,
} from "@ai-sdk/provider";
import { concatBytes, parseEventStreamMessages } from "./bedrock-eventstream";

export type BedrockProviderConfig = {
  apiKey: string;
  region: string;
};

type BedrockContentBlock = { text: string };
type BedrockMessage = { role: "user" | "assistant"; content: BedrockContentBlock[] };

type BedrockConverseBody = {
  messages: BedrockMessage[];
  system?: Array<{ text: string }>;
  inferenceConfig?: {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    stopSequences?: string[];
  };
};

type BedrockUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

function bedrockEndpoint(region: string, modelId: string, stream: boolean): string {
  const action = stream ? "converse-stream" : "converse";
  return `https://bedrock-runtime.${region}.amazonaws.com/model/${modelId}/${action}`;
}

function collectText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object" || !("type" in part)) continue;
    if (part.type === "text" && "text" in part && typeof part.text === "string") {
      parts.push(part.text);
    } else if (part.type === "tool-call" && "toolName" in part) {
      parts.push(`[tool call ${String(part.toolName)}] ${JSON.stringify(part.args)}`);
    } else if (part.type === "tool-result" && "toolName" in part) {
      parts.push(
        `[tool result ${String(part.toolName)}] ${
          typeof part.result === "string" ? part.result : JSON.stringify(part.result)
        }`,
      );
    }
  }
  return parts.join("\n");
}

export function convertPromptToConverse(prompt: LanguageModelV1Prompt): {
  messages: BedrockMessage[];
  system?: Array<{ text: string }>;
} {
  const systemParts: string[] = [];
  const messages: BedrockMessage[] = [];

  for (const message of prompt) {
    if (message.role === "system") {
      const text = collectText(message.content);
      if (text) systemParts.push(text);
      continue;
    }

    const text = collectText(message.content);
    if (!text) continue;

    const role: "user" | "assistant" = message.role === "assistant" ? "assistant" : "user";
    const last = messages[messages.length - 1];
    if (last && last.role === role) {
      last.content[0] = { text: `${last.content[0]?.text ?? ""}\n${text}` };
    } else {
      messages.push({ role, content: [{ text }] });
    }
  }

  if (messages.length === 0) {
    messages.push({ role: "user", content: [{ text: "" }] });
  }
  if (messages[0]?.role !== "user") {
    messages.unshift({ role: "user", content: [{ text: "" }] });
  }

  return {
    messages,
    ...(systemParts.length > 0 ? { system: [{ text: systemParts.join("\n\n") }] } : {}),
  };
}

function buildConverseBody(options: LanguageModelV1CallOptions): {
  body: BedrockConverseBody;
  warnings: LanguageModelV1CallWarning[];
} {
  const warnings: LanguageModelV1CallWarning[] = [];
  const converted = convertPromptToConverse(options.prompt);
  const inferenceConfig: BedrockConverseBody["inferenceConfig"] = {};

  if (options.maxTokens != null) inferenceConfig.maxTokens = options.maxTokens;
  if (options.temperature != null) inferenceConfig.temperature = options.temperature;
  if (options.topP != null) inferenceConfig.topP = options.topP;
  if (options.stopSequences?.length) inferenceConfig.stopSequences = options.stopSequences;

  if (options.topK != null) {
    warnings.push({ type: "unsupported-setting", setting: "topK" });
  }
  if (options.presencePenalty != null) {
    warnings.push({ type: "unsupported-setting", setting: "presencePenalty" });
  }
  if (options.frequencyPenalty != null) {
    warnings.push({ type: "unsupported-setting", setting: "frequencyPenalty" });
  }
  if (options.seed != null) {
    warnings.push({ type: "unsupported-setting", setting: "seed" });
  }
  if (options.mode.type === "regular" && options.mode.tools?.length) {
    for (const tool of options.mode.tools) {
      warnings.push({
        type: "unsupported-tool",
        tool,
        details: "Bedrock overflow serves text only; tool calls are dropped.",
      });
    }
  }

  return {
    body: {
      ...converted,
      ...(Object.keys(inferenceConfig).length > 0 ? { inferenceConfig } : {}),
    },
    warnings,
  };
}

function mapStopReason(reason: unknown): LanguageModelV1FinishReason {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "length";
    case "content_filtered":
    case "guardrail_intervened":
      return "content-filter";
    case "tool_use":
      return "tool-calls";
    default:
      return reason == null ? "unknown" : "other";
  }
}

function usageFromBedrock(usage: BedrockUsage | undefined): {
  promptTokens: number;
  completionTokens: number;
} {
  return {
    promptTokens: usage?.inputTokens ?? 0,
    completionTokens: usage?.outputTokens ?? 0,
  };
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 2000);
  } catch {
    return "";
  }
}

class BedrockChatLanguageModel implements LanguageModelV1 {
  readonly specificationVersion = "v1" as const;
  readonly provider = "bedrock";
  readonly defaultObjectGenerationMode = undefined;
  readonly supportsImageUrls = false;

  constructor(
    readonly modelId: string,
    private readonly config: BedrockProviderConfig,
  ) {}

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${this.config.apiKey}`,
    };
  }

  async doGenerate(options: LanguageModelV1CallOptions) {
    const { body, warnings } = buildConverseBody(options);
    const url = bedrockEndpoint(this.config.region, this.modelId, false);
    const requestBody = JSON.stringify(body);

    const response = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: requestBody,
      signal: options.abortSignal,
    });

    if (!response.ok) {
      throw new Error(
        `Bedrock converse failed (${response.status}): ${await readErrorBody(response)}`,
      );
    }

    const json = (await response.json()) as {
      output?: { message?: { content?: Array<{ text?: string }> } };
      stopReason?: string;
      usage?: BedrockUsage;
    };
    const text = json.output?.message?.content?.map((block) => block.text ?? "").join("") ?? "";

    return {
      text,
      finishReason: mapStopReason(json.stopReason),
      usage: usageFromBedrock(json.usage),
      rawCall: { rawPrompt: body, rawSettings: {} },
      rawResponse: { headers: Object.fromEntries(response.headers.entries()) },
      request: { body: requestBody },
      warnings,
    };
  }

  async doStream(options: LanguageModelV1CallOptions) {
    const { body, warnings } = buildConverseBody(options);
    const url = bedrockEndpoint(this.config.region, this.modelId, true);
    const requestBody = JSON.stringify(body);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...this.headers(),
        Accept: "application/vnd.amazon.eventstream",
      },
      body: requestBody,
      signal: options.abortSignal,
    });

    if (!response.ok) {
      throw new Error(
        `Bedrock converse-stream failed (${response.status}): ${await readErrorBody(response)}`,
      );
    }
    if (!response.body) {
      throw new Error("Bedrock converse-stream returned an empty body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    const stream = new ReadableStream<LanguageModelV1StreamPart>({
      start: async (controller) => {
        // ReadableStream chunks and parse leftovers are Uint8Array<ArrayBufferLike>;
        // `new Uint8Array(0)` infers the narrower Uint8Array<ArrayBuffer>.
        let buffer: Uint8Array = new Uint8Array(0);
        let finishReason: LanguageModelV1FinishReason = "unknown";
        let usage = { promptTokens: 0, completionTokens: 0 };

        const emitError = (error: unknown) => {
          controller.enqueue({ type: "error", error });
          controller.enqueue({
            type: "finish",
            finishReason: "error",
            usage,
          });
          controller.close();
        };

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer = concatBytes(buffer, value);
            const parsed = parseEventStreamMessages(buffer);
            buffer = parsed.rest;

            for (const message of parsed.messages) {
              const messageType = message.headers[":message-type"];
              const eventType = message.headers[":event-type"];
              const payloadText = decoder.decode(message.payload);
              let payload: Record<string, unknown> = {};
              if (payloadText) {
                try {
                  payload = JSON.parse(payloadText) as Record<string, unknown>;
                } catch {
                  payload = { raw: payloadText };
                }
              }

              if (messageType === "exception" || messageType === "error") {
                throw new Error(
                  `Bedrock stream error (${eventType ?? "unknown"}): ${payloadText.slice(0, 500)}`,
                );
              }

              if (eventType === "contentBlockDelta") {
                const delta = payload.delta as { text?: string } | undefined;
                if (delta?.text) {
                  controller.enqueue({ type: "text-delta", textDelta: delta.text });
                }
              } else if (eventType === "messageStop") {
                finishReason = mapStopReason(payload.stopReason);
              } else if (eventType === "metadata") {
                usage = usageFromBedrock(payload.usage as BedrockUsage | undefined);
              }
            }
          }

          controller.enqueue({ type: "finish", finishReason, usage });
          controller.close();
        } catch (error) {
          emitError(error);
        } finally {
          try {
            await reader.cancel();
          } catch {
            /* ignore */
          }
        }
      },
    });

    return {
      stream,
      rawCall: { rawPrompt: body, rawSettings: {} },
      rawResponse: { headers: Object.fromEntries(response.headers.entries()) },
      request: { body: requestBody },
      warnings,
    };
  }
}

export function createBedrockProvider(config: BedrockProviderConfig) {
  return {
    languageModel(modelId: string): LanguageModelV1 {
      return new BedrockChatLanguageModel(modelId, config);
    },
  };
}
