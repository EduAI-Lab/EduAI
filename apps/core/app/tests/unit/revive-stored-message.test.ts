import { describe, it, expect } from "vitest";
import { messageToText, reviveStoredMessage } from "~/lib/chat/revive-message.server";

/**
 * Regression tests for chat-history restore rendering. The DB has accumulated
 * several historical content shapes from past save bugs; revive must flatten all
 * of them to the real markdown text so restore + read-only transcript never show
 * a blank bubble, "[object Object]", or a raw JSON blob.
 */
describe("messageToText", () => {
  it("returns a plain string as-is", () => {
    expect(messageToText("**hi**")).toBe("**hi**");
  });

  it("extracts text from an AI-SDK content array (Shape 1)", () => {
    expect(messageToText([{ type: "text", text: "**Knapsack**" }])).toBe("**Knapsack**");
  });

  it("unwraps a double-serialized message object in a text field (Shape 2)", () => {
    const inner = JSON.stringify({
      id: "msg-1",
      role: "assistant",
      content: [{ type: "text", text: "Yes, **ADHD Assist Mode is on.**" }],
    });
    expect(messageToText([{ type: "text", text: inner }])).toBe(
      "Yes, **ADHD Assist Mode is on.**",
    );
  });

  it("reads UIMessage parts", () => {
    expect(messageToText({ parts: [{ type: "text", text: "hello" }] })).toBe("hello");
  });

  it("returns empty string for null/undefined", () => {
    expect(messageToText(null)).toBe("");
    expect(messageToText(undefined)).toBe("");
  });
});

describe("reviveStoredMessage", () => {
  it("recovers array content and exposes both content + parts as text", () => {
    const revived = reviveStoredMessage({
      messageId: "m1",
      role: "assistant",
      content: { id: "x", role: "assistant", content: [{ type: "text", text: "real answer" }] },
    });
    expect(revived.content).toBe("real answer");
    expect(revived.parts).toEqual([{ type: "text", text: "real answer" }]);
    expect(revived.id).toBe("x");
  });

  it("recovers double-serialized assistant message", () => {
    const inner = JSON.stringify({
      role: "assistant",
      content: [{ type: "text", text: "recovered" }],
    });
    const revived = reviveStoredMessage({
      messageId: "m2",
      role: "assistant",
      content: { id: "y", role: "assistant", parts: [{ type: "text", text: inner }] },
    });
    expect(revived.content).toBe("recovered");
  });

  it("keeps clean string content untouched", () => {
    const revived = reviveStoredMessage({
      messageId: "m3",
      role: "user",
      content: { id: "z", role: "user", content: "hello." },
    });
    expect(revived.content).toBe("hello.");
  });

  it("falls back to messageId/role when missing", () => {
    const revived = reviveStoredMessage({ messageId: "m4", role: "user", content: "plain" });
    expect(revived.id).toBe("m4");
    expect(revived.role).toBe("user");
    expect(revived.content).toBe("plain");
  });

  it("preserves validated resolved-model metadata on assistant messages", () => {
    const revived = reviveStoredMessage({
      messageId: "m5",
      role: "assistant",
      content: {
        id: "m5",
        role: "assistant",
        content: "answer",
        metadata: { resolvedModelId: "openai:gpt-4o" },
      },
    });

    expect(revived.metadata).toEqual({ resolvedModelId: "openai:gpt-4o" });
  });

  it("preserves durable long-output-cap metadata on assistant messages", () => {
    const revived = reviveStoredMessage({
      messageId: "m6",
      role: "assistant",
      content: {
        id: "m6",
        role: "assistant",
        content: "truncated answer",
        metadata: {
          resolvedModelId: "openai:gpt-4o",
          hitLongOutputCap: true,
        },
      },
    });

    expect(revived.metadata).toEqual({
      resolvedModelId: "openai:gpt-4o",
      hitLongOutputCap: true,
    });
  });

  it("preserves the long-output-cap flag without resolved-model metadata", () => {
    const revived = reviveStoredMessage({
      messageId: "m7",
      role: "assistant",
      content: {
        content: "truncated answer",
        metadata: { hitLongOutputCap: true },
      },
    });

    expect(revived.metadata).toEqual({ hitLongOutputCap: true });
  });

  it("drops malformed or non-assistant resolved-model metadata", () => {
    const malformed = reviveStoredMessage({
      messageId: "m8",
      role: "assistant",
      content: {
        content: "answer",
        metadata: { resolvedModelId: "not-a-registry-id" },
      },
    });
    const user = reviveStoredMessage({
      messageId: "m9",
      role: "user",
      content: {
        content: "question",
        metadata: { resolvedModelId: "openai:gpt-4o" },
      },
    });

    expect(malformed).not.toHaveProperty("metadata");
    expect(user).not.toHaveProperty("metadata");
  });
});
