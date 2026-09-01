import { describe, expect, it } from "vitest";

// The benchmark is an executable ESM script, but importing it is safe because
// its main() call is guarded to direct invocation only.
const { responseChatId } = await import("../../../scripts/chat-latency-bench.mjs");

describe("chat latency benchmark", () => {
  it("keeps a streaming chat session from the X-Chat-Id response header", () => {
    const response = new Response("0:stream data", {
      headers: { "X-Chat-Id": "streaming-chat-id" },
    });

    expect(responseChatId(response, null)).toBe("streaming-chat-id");
  });

  it("retains the JSON chatId fallback for non-streaming responses", () => {
    expect(responseChatId(new Response("{}"), { chatId: "json-chat-id" })).toBe("json-chat-id");
  });
});
