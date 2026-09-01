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
  LanguageModelV1Message,
  LanguageModelV1Prompt,
  LanguageModelV1StreamPart,
  ProviderV1,
} from "@ai-sdk/provider";
import { NoSuchModelError } from "@ai-sdk/provider";
import { z } from "zod";
import { parseJsonText } from "~/lib/json-value";
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

/** The `messages`/`system` half of a Converse body, before call options fill in the rest. */
type BedrockConversePrompt = Pick<BedrockConverseBody, "messages" | "system">;

/** A Converse body plus the call options this provider had to drop to build it. */
type BedrockConverseRequest = {
  body: BedrockConverseBody;
  warnings: LanguageModelV1CallWarning[];
};

/** Token counts in the shape the AI SDK's `usage` field expects. */
type BedrockTokenUsage = {
  promptTokens: number;
  completionTokens: number;
};

/** The content of one prompt message: a system string, or the SDK's typed parts. */
type BedrockPromptContent = LanguageModelV1Message["content"];

const bedrockUsageSchema = z.object({
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  totalTokens: z.number().optional(),
});

type BedrockUsage = z.infer<typeof bedrockUsageSchema>;

/** A non-streaming Converse response. Every field is optional: Bedrock omits them on a filtered turn. */
const bedrockConverseResponseSchema = z.object({
  output: z
    .object({
      message: z
        .object({ content: z.array(z.object({ text: z.string().optional() })).optional() })
        .optional(),
    })
    .optional(),
  stopReason: z.string().optional(),
  usage: bedrockUsageSchema.optional(),
});

/**
 * One decoded event-stream payload.
 *
 * The three event types this provider reads (`contentBlockDelta`, `messageStop`,
 * `metadata`) are folded into one all-optional object rather than a discriminated
 * union: the payload carries no discriminator of its own, the event name lives in
 * the frame header, and each branch reads exactly one field.
 */
const bedrockStreamPayloadSchema = z.object({
  delta: z.object({ text: z.string().optional() }).optional(),
  stopReason: z.string().optional(),
  usage: bedrockUsageSchema.optional(),
});

type BedrockStreamPayload = z.infer<typeof bedrockStreamPayloadSchema>;

function bedrockEndpoint(region: string, modelId: string, stream: boolean): string {
  const action = stream ? "converse-stream" : "converse";
  return `https://bedrock-runtime.${region}.amazonaws.com/model/${modelId}/${action}`;
}

/**
 * Flattens one message's content to plain text.
 *
 * Converse serves text only, so image, file and reasoning parts are dropped;
 * tool calls and results are rendered inline so the model still sees that they
 * happened.
 */
/**
 * The string arm of a prompt content union. Its arms differ only by primitive
 * type, so this decodes rather than re-checks the shape at each branch.
 */
const isPromptText = <T>(value: string | T): value is string => z.string().safeParse(value).success;

function collectText(content: BedrockPromptContent): string {
  if (isPromptText(content)) return content;
  const parts: string[] = [];
  for (const part of content) {
    switch (part.type) {
      case "text":
        parts.push(part.text);
        break;
      case "tool-call":
        parts.push(`[tool call ${part.toolName}] ${JSON.stringify(part.args)}`);
        break;
      case "tool-result":
        parts.push(
          `[tool result ${part.toolName}] ${
            isPromptText(part.result) ? part.result : JSON.stringify(part.result)
          }`,
        );
        break;
      default:
        break;
    }
  }
  return parts.join("\n");
}

export function convertPromptToConverse(prompt: LanguageModelV1Prompt): BedrockConversePrompt {
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
    // Converse rejects an empty system block, so a prompt with no system parts
    // sends none at all.
    messages,
    system: systemParts.length > 0 ? [{ text: systemParts.join("\n\n") }] : undefined,
  };
}

function buildConverseBody(options: LanguageModelV1CallOptions): BedrockConverseRequest {
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
      // An empty config block is rejected upstream; send it only once a call
      // option has actually populated it.
      inferenceConfig: Object.keys(inferenceConfig).length > 0 ? inferenceConfig : undefined,
    },
    warnings,
  };
}

function mapStopReason(reason: string | undefined): LanguageModelV1FinishReason {
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

function usageFromBedrock(usage: BedrockUsage | undefined): BedrockTokenUsage {
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

  private headers() {
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

    // `safeParse`, not `parse`: every field is optional because Bedrock omits
    // them on a filtered turn, so a payload this provider does not model must
    // degrade to empty text and zero usage rather than throw out of the call —
    // the same rule the stream path below already follows.
    const decoded = bedrockConverseResponseSchema.safeParse(await response.json());
    const json = decoded.success ? decoded.data : {};
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

        const emitError = (cause: unknown) => {
          controller.enqueue({ type: "error", error: cause });
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
              // A frame this provider does not read, or one Bedrock sends in a
              // shape we do not model, degrades to an empty payload: the branches
              // below all guard on the field they need, and an error frame is
              // reported from its header rather than its body.
              let payload: BedrockStreamPayload = {};
              if (payloadText) {
                const decoded = bedrockStreamPayloadSchema.safeParse(parseJsonText(payloadText));
                if (decoded.success) payload = decoded.data;
              }

              if (messageType === "exception" || messageType === "error") {
                throw new Error(
                  `Bedrock stream error (${eventType ?? "unknown"}): ${payloadText.slice(0, 500)}`,
                );
              }

              if (eventType === "contentBlockDelta") {
                if (payload.delta?.text) {
                  controller.enqueue({ type: "text-delta", textDelta: payload.delta.text });
                }
              } else if (eventType === "messageStop") {
                finishReason = mapStopReason(payload.stopReason);
              } else if (eventType === "metadata") {
                usage = usageFromBedrock(payload.usage);
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

export function createBedrockProvider(config: BedrockProviderConfig): ProviderV1 {
  return {
    languageModel(modelId: string): LanguageModelV1 {
      return new BedrockChatLanguageModel(modelId, config);
    },
    // Converse is text-only and this provider is overflow-only (#1441), so an
    // embedding lookup is a caller mistake, not a gap to fill. `ProviderV1`
    // requires the method; the SDK's own error is the right answer to it.
    textEmbeddingModel(modelId: string): never {
      throw new NoSuchModelError({ modelId, modelType: "textEmbeddingModel" });
    },
  };
}
