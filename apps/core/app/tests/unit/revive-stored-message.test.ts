import { describe, it, expect } from "vitest";
import {
  messageToText,
  reviveStoredMessage,
} from "~/lib/chat/revive-message.server";

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
    expect(messageToText([{ type: "text", text: "**Knapsack**" }])).toBe(
      "**Knapsack**",
    );
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
    expect(messageToText({ parts: [{ type: "text", text: "hello" }] })).toBe(
      "hello",
    );
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
      content: {
        id: "x",
        role: "assistant",
        content: [{ type: "text", text: "real answer" }],
      },
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
      content: {
        id: "y",
        role: "assistant",
        parts: [{ type: "text", text: inner }],
      },
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
    const revived = reviveStoredMessage({
      messageId: "m4",
      role: "user",
      content: "plain",
    });
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

    expect(revived.metadata).toEqual({
      resolvedModelId: "openai:gpt-4o",
      wasAutoRouted: false,
    });
  });

  it("preserves the auto-routed flag across reload (#829 regression)", () => {
    const revived = reviveStoredMessage({
      messageId: "m8",
      role: "assistant",
      content: {
        id: "m8",
        role: "assistant",
        content: "answer",
        metadata: { resolvedModelId: "vllm:qwen2.5-7b-instruct", wasAutoRouted: true },
      },
    });

    expect(revived.metadata).toEqual({
      resolvedModelId: "vllm:qwen2.5-7b-instruct",
      wasAutoRouted: true,
    });
  });

  it("drops malformed or non-assistant resolved-model metadata", () => {
    const malformed = reviveStoredMessage({
      messageId: "m6",
      role: "assistant",
      content: {
        content: "answer",
        metadata: { resolvedModelId: "not-a-registry-id" },
      },
    });
    const user = reviveStoredMessage({
      messageId: "m7",
      role: "user",
      content: {
        content: "question",
        metadata: { resolvedModelId: "openai:gpt-4o" },
      },
    });

    expect(malformed).not.toHaveProperty("metadata");
    expect(user).not.toHaveProperty("metadata");
  });

  it("restores the course-scope redirect flag on assistant messages", () => {
    const revived = reviveStoredMessage({
      messageId: "m8",
      role: "assistant",
      content: {
        id: "m8",
        role: "assistant",
        content: "That looks outside the scope of this course.",
        metadata: { courseScopeRedirect: true },
      },
    });

    expect(revived.metadata).toEqual({ courseScopeRedirect: true });
  });

  it("does not restore the course-scope redirect flag on non-assistant messages", () => {
    const revived = reviveStoredMessage({
      messageId: "m9",
      role: "user",
      content: {
        content: "question",
        metadata: { courseScopeRedirect: true },
      },
    });

    expect(revived).not.toHaveProperty("metadata");
  });

  it("preserves both resolved-model and course-scope-redirect metadata together", () => {
    const revived = reviveStoredMessage({
      messageId: "m10",
      role: "assistant",
      content: {
        id: "m10",
        role: "assistant",
        content: "That looks outside the scope of this course.",
        metadata: {
          resolvedModelId: "openai:gpt-4o",
          courseScopeRedirect: true,
        },
      },
    });

    expect(revived.metadata).toEqual({
      resolvedModelId: "openai:gpt-4o",
      wasAutoRouted: false,
      courseScopeRedirect: true,
    });
  });
});
