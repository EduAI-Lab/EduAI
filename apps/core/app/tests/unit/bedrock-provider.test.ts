// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LanguageModelV1CallOptions } from "@ai-sdk/provider";
import {
  convertPromptToConverse,
  createBedrockProvider,
} from "~/lib/ai/routing/bedrock/bedrock-provider.server";
import { encodeEventStreamMessage } from "~/lib/ai/routing/bedrock/bedrock-eventstream";

function regularCall(
  overrides: Partial<LanguageModelV1CallOptions> = {},
): LanguageModelV1CallOptions {
  return {
    inputFormat: "messages",
    mode: { type: "regular" },
    prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
    ...overrides,
  };
}

describe("convertPromptToConverse", () => {
  it("lifts system messages and merges consecutive same-role turns", () => {
    const converted = convertPromptToConverse([
      { role: "system", content: "Be brief." },
      { role: "user", content: [{ type: "text", text: "Hello" }] },
      { role: "user", content: [{ type: "text", text: "again" }] },
      { role: "assistant", content: [{ type: "text", text: "Hi" }] },
    ]);

    expect(converted.system).toEqual([{ text: "Be brief." }]);
    expect(converted.messages).toEqual([
      { role: "user", content: [{ text: "Hello\nagain" }] },
      { role: "assistant", content: [{ text: "Hi" }] },
    ]);
  });
});

describe("createBedrockProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("doGenerate posts to /converse with the bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: { message: { content: [{ text: "Paris" }] } },
          stopReason: "end_turn",
          usage: { inputTokens: 4, outputTokens: 1 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const model = createBedrockProvider({
      apiKey: "test-token",
      region: "us-east-1",
    }).languageModel("meta.llama3-70b-instruct-v1:0");

    const result = await model.doGenerate(regularCall());

    expect(fetchMock).toHaveBeenCalledWith(
      "https://bedrock-runtime.us-east-1.amazonaws.com/model/meta.llama3-70b-instruct-v1:0/converse",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      }),
    );
    expect(result.text).toBe("Paris");
    expect(result.finishReason).toBe("stop");
    expect(result.usage).toEqual({ promptTokens: 4, completionTokens: 1 });
  });

  it("doStream translates contentBlockDelta events into text-delta parts", async () => {
    const delta = encodeEventStreamMessage(
      { ":message-type": "event", ":event-type": "contentBlockDelta" },
      new TextEncoder().encode(JSON.stringify({ delta: { text: "Hel" } })),
    );
    const stop = encodeEventStreamMessage(
      { ":message-type": "event", ":event-type": "messageStop" },
      new TextEncoder().encode(JSON.stringify({ stopReason: "end_turn" })),
    );
    const meta = encodeEventStreamMessage(
      { ":message-type": "event", ":event-type": "metadata" },
      new TextEncoder().encode(JSON.stringify({ usage: { inputTokens: 2, outputTokens: 3 } })),
    );
    const body = new Uint8Array(delta.length + stop.length + meta.length);
    body.set(delta, 0);
    body.set(stop, delta.length);
    body.set(meta, delta.length + stop.length);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/vnd.amazon.eventstream" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const model = createBedrockProvider({
      apiKey: "test-token",
      region: "us-west-2",
    }).languageModel("meta.llama3-70b-instruct-v1:0");

    const { stream } = await model.doStream(regularCall());
    const parts = [];
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }

    expect(fetchMock.mock.calls[0]?.[0]).toContain("/converse-stream");
    expect(parts).toEqual([
      { type: "text-delta", textDelta: "Hel" },
      {
        type: "finish",
        finishReason: "stop",
        usage: { promptTokens: 2, completionTokens: 3 },
      },
    ]);
  });
});
