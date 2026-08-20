// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  crc32,
  encodeEventStreamMessage,
  parseEventStreamMessages,
} from "~/lib/ai/routing/bedrock/bedrock-eventstream";

describe("crc32", () => {
  it("matches the ISO 3309 vector for 123456789", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});

describe("parseEventStreamMessages", () => {
  it("round-trips a ConverseStream text-delta event", () => {
    const payload = new TextEncoder().encode(
      JSON.stringify({ delta: { text: "Hello" }, contentBlockIndex: 0 }),
    );
    const encoded = encodeEventStreamMessage(
      {
        ":message-type": "event",
        ":event-type": "contentBlockDelta",
        ":content-type": "application/json",
      },
      payload,
    );

    const { messages, rest } = parseEventStreamMessages(encoded);
    expect(rest.length).toBe(0);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.headers[":event-type"]).toBe("contentBlockDelta");
    expect(JSON.parse(new TextDecoder().decode(messages[0]?.payload))).toEqual({
      delta: { text: "Hello" },
      contentBlockIndex: 0,
    });
  });

  it("holds an incomplete trailing frame in rest", () => {
    const encoded = encodeEventStreamMessage(
      { ":event-type": "messageStop" },
      new TextEncoder().encode(JSON.stringify({ stopReason: "end_turn" })),
    );
    const truncated = encoded.subarray(0, encoded.length - 3);
    const { messages, rest } = parseEventStreamMessages(truncated);
    expect(messages).toHaveLength(0);
    expect(rest.length).toBe(truncated.length);
  });

  it("parses two concatenated messages", () => {
    const first = encodeEventStreamMessage(
      { ":event-type": "contentBlockDelta" },
      new TextEncoder().encode(JSON.stringify({ delta: { text: "Hi" } })),
    );
    const second = encodeEventStreamMessage(
      { ":event-type": "messageStop" },
      new TextEncoder().encode(JSON.stringify({ stopReason: "end_turn" })),
    );
    const joined = new Uint8Array(first.length + second.length);
    joined.set(first, 0);
    joined.set(second, first.length);

    const { messages, rest } = parseEventStreamMessages(joined);
    expect(rest.length).toBe(0);
    expect(messages.map((m) => m.headers[":event-type"])).toEqual([
      "contentBlockDelta",
      "messageStop",
    ]);
  });
});
