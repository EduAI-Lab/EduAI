import { describe, it, expect, afterEach } from "vitest";
import {
  buildCappedRagContextText,
  buildPriorChatDigestMessage,
  capRagHitsForTool,
  capToolResultsInMessages,
  estimateMessageCharsForModel,
  prepareBoundedSessionContext,
  resolveMaxContextMessages,
  resolveSessionCharBudget,
  resolveToolResultMaxChars,
  truncateToMaxChars,
  HYBRID_RAG_MAX_CHUNKS,
  HYBRID_RAG_MAX_CONTEXT_CHARS,
  TOOL_RAG_MAX_CHARS_PER_CHUNK,
  HYBRID_RAG_MIN_TRUNCATE_CHARS,
  type HybridRagHit,
} from "~/lib/chat-rag";

function hit(content: string, title = "Lecture 1"): HybridRagHit {
  return { content, similarity: 0.9, materialTitle: title };
}

describe("buildCappedRagContextText", () => {
  it("returns empty string for no hits", () => {
    expect(buildCappedRagContextText([], 4, 1000)).toBe("");
  });

  it("includes source headers and joins chunks with separators", () => {
    const text = buildCappedRagContextText(
      [hit("alpha"), hit("beta", "Reading 2")],
      4,
      10_000,
    );
    expect(text).toContain("**Source**: Lecture 1");
    expect(text).toContain("alpha");
    expect(text).toContain("**Source**: Reading 2");
    expect(text).toContain("beta");
    expect(text).toContain("\n\n---\n\n");
  });

  it("limits to maxChunks even when more hits are provided", () => {
    const hits = [
      hit("chunk-one"),
      hit("chunk-two"),
      hit("chunk-three"),
      hit("chunk-four"),
    ];
    const text = buildCappedRagContextText(hits, 2, 10_000);
    expect(text).toContain("chunk-one");
    expect(text).toContain("chunk-two");
    expect(text).not.toContain("chunk-three");
  });

  it("truncates the last chunk when over maxChars with enough room to partial-fit", () => {
    const longBody = "x".repeat(500);
    const headerLen = "**Source**: Lecture 1\n".length;
    const maxChars = headerLen + HYBRID_RAG_MIN_TRUNCATE_CHARS + 10;
    const text = buildCappedRagContextText([hit(longBody)], 1, maxChars);
    expect(text.endsWith("…")).toBe(true);
    expect(text.length).toBeLessThanOrEqual(maxChars + 5);
  });

  it("omits the chunk when remaining room is at or below HYBRID_RAG_MIN_TRUNCATE_CHARS", () => {
    const title = "T";
    const header = `**Source**: ${title}\n`;
    const body = "x".repeat(20);
    const maxChars = header.length + body.length - 1;
    const text = buildCappedRagContextText([hit(body, title)], 1, maxChars);
    expect(text).toBe("");
  });
});

describe("capRagHitsForTool", () => {
  it("returns empty array for no hits", () => {
    expect(capRagHitsForTool([])).toEqual([]);
  });

  it("keeps at most HYBRID_RAG_MAX_CHUNKS hits", () => {
    const hits = Array.from({ length: 10 }, (_, i) => hit(`chunk-${i}`));
    const capped = capRagHitsForTool(hits);
    expect(capped).toHaveLength(HYBRID_RAG_MAX_CHUNKS);
    expect(capped[0].content).toBe("chunk-0");
    expect(capped[HYBRID_RAG_MAX_CHUNKS - 1].content).toBe(`chunk-${HYBRID_RAG_MAX_CHUNKS - 1}`);
  });

  it("truncates content longer than TOOL_RAG_MAX_CHARS_PER_CHUNK", () => {
    const long = "z".repeat(TOOL_RAG_MAX_CHARS_PER_CHUNK + 100);
    const [capped] = capRagHitsForTool([hit(long)]);
    expect(capped.content.length).toBe(TOOL_RAG_MAX_CHARS_PER_CHUNK + 1);
    expect(capped.content.endsWith("…")).toBe(true);
  });

  it("leaves short content unchanged", () => {
    const [capped] = capRagHitsForTool([hit("short")]);
    expect(capped.content).toBe("short");
    expect(capped.materialTitle).toBe("Lecture 1");
  });
});

describe("RAG cap constants", () => {
  it("exports expected defaults for hybrid and tool paths", () => {
    expect(HYBRID_RAG_MAX_CHUNKS).toBe(4);
    expect(HYBRID_RAG_MAX_CONTEXT_CHARS).toBe(14_000);
    expect(TOOL_RAG_MAX_CHARS_PER_CHUNK).toBe(6000);
    expect(HYBRID_RAG_MIN_TRUNCATE_CHARS).toBe(120);
  });
});

describe("truncateToMaxChars", () => {
  it("returns the original string when under the limit", () => {
    expect(truncateToMaxChars("hello", 10)).toBe("hello");
  });

  it("appends the ellipsis suffix when over the limit", () => {
    const result = truncateToMaxChars("abcdefgh", 5);
    expect(result).toBe("abcde…");
    expect(result.length).toBe(6);
  });
});

describe("resolveToolResultMaxChars", () => {
  const original = process.env.CHAT_TOOL_RAG_MAX_CHARS_PER_CHUNK;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.CHAT_TOOL_RAG_MAX_CHARS_PER_CHUNK;
    } else {
      process.env.CHAT_TOOL_RAG_MAX_CHARS_PER_CHUNK = original;
    }
  });

  it("defaults to TOOL_RAG_MAX_CHARS_PER_CHUNK when env is unset", () => {
    delete process.env.CHAT_TOOL_RAG_MAX_CHARS_PER_CHUNK;
    expect(resolveToolResultMaxChars()).toBe(TOOL_RAG_MAX_CHARS_PER_CHUNK);
  });

  it("clamps env override to the allowed range", () => {
    process.env.CHAT_TOOL_RAG_MAX_CHARS_PER_CHUNK = "999999";
    expect(resolveToolResultMaxChars()).toBe(50_000);
    process.env.CHAT_TOOL_RAG_MAX_CHARS_PER_CHUNK = "10";
    expect(resolveToolResultMaxChars()).toBe(500);
  });
});

describe("capToolResultsInMessages", () => {
  it("leaves user messages unchanged", () => {
    const messages = [{ id: "1", role: "user", content: "x".repeat(10_000) }];
    const capped = capToolResultsInMessages(messages, 100);
    expect(capped[0]).toBe(messages[0]);
    expect(capped[0].content).toBe(messages[0].content);
  });

  it("truncates oversized tool results inside assistant messages", () => {
    const longMarkdown = "m".repeat(20_000);
    const messages = [
      {
        id: "1",
        role: "assistant",
        content: [
          {
            type: "tool-invocation",
            toolInvocation: {
              toolName: "fetchPage",
              toolCallId: "call-1",
              state: "result",
              result: { markdown: longMarkdown, url: "https://example.com" },
            },
          },
        ],
      },
    ];

    const capped = capToolResultsInMessages(messages, 6000);
    const result = (capped[0].content as Array<{ toolInvocation: { result: { markdown: string } } }>)[0]
      .toolInvocation.result.markdown;

    expect(result.length).toBe(6001);
    expect(result.endsWith("…")).toBe(true);
  });

  it("caps tool-role messages", () => {
    const messages = [{ id: "1", role: "tool", content: "t".repeat(8000) }];
    const capped = capToolResultsInMessages(messages, 6000);
    expect((capped[0].content as string).length).toBe(6001);
  });
});

/** Realistic AI SDK assistant message carrying a `fetchPage` tool result. */
function toolResultMessage(id: string, markdownLength: number, role = "assistant") {
  return {
    id,
    role,
    content: [
      {
        type: "tool-invocation",
        toolInvocation: {
          toolName: "fetchPage",
          toolCallId: `call-${id}`,
          state: "result",
          result: { markdown: "m".repeat(markdownLength), url: "https://example.com" },
        },
      },
    ],
  };
}

/** Model-input size, counting tool payloads — mirrors production wiring. */
function totalModelChars(messages: Array<Record<string, unknown>>): number {
  return messages.reduce((sum, message) => sum + estimateMessageCharsForModel(message), 0);
}

describe("estimateMessageCharsForModel", () => {
  it("counts string content by its length", () => {
    expect(estimateMessageCharsForModel({ role: "user", content: "hello" })).toBe(5);
  });

  it("counts tool-invocation payloads, not just text parts", () => {
    const chars = estimateMessageCharsForModel(toolResultMessage("1", 5000));
    // A naive text-parts extractor would return 0 here; we must see the payload.
    expect(chars).toBeGreaterThan(5000);
  });

  it("returns 0 for empty or content-less messages", () => {
    expect(estimateMessageCharsForModel(undefined)).toBe(0);
    expect(estimateMessageCharsForModel({ role: "user" })).toBe(0);
  });
});

describe("prepareBoundedSessionContext", () => {
  it("returns short threads unchanged", () => {
    const messages = [
      { id: "1", role: "user", content: "hello" },
      { id: "2", role: "assistant", content: "hi there" },
    ];
    expect(prepareBoundedSessionContext(messages, { charBudget: 10_000 })).toBe(messages);
  });

  it("replaces older turns with a digest and keeps the recent tail", () => {
    const messages = [
      { id: "1", role: "user", content: "a".repeat(5000) },
      { id: "2", role: "assistant", content: "b".repeat(5000) },
      { id: "3", role: "user", content: "recent question" },
      { id: "4", role: "assistant", content: "recent answer" },
    ];

    const bounded = prepareBoundedSessionContext(messages, {
      charBudget: 500,
      recentCount: 2,
      digestMaxChars: 300,
    });

    expect(bounded).toHaveLength(3);
    expect(bounded[0].id).toBe("session-digest");
    expect(bounded[0].content).toContain("Session digest");
    expect(bounded[1].content).toBe("recent question");
    expect(bounded[2].content).toBe("recent answer");
  });

  it("triggers the digest on tool-heavy threads where text parts are tiny", () => {
    // Two ~6k fetchPage turns: a text-only counter would see ~0 chars and never
    // digest. With payload-aware accounting the thread is over budget and the
    // oversized blobs are removed from the model input.
    const messages = [
      toolResultMessage("1", 6000),
      toolResultMessage("2", 6000),
      { id: "3", role: "user", content: "latest question" },
      { id: "4", role: "assistant", content: "latest answer" },
    ];

    const bounded = prepareBoundedSessionContext(messages, {
      charBudget: 10_000,
      recentCount: 2,
      digestMaxChars: 2_000,
    });

    expect(bounded).not.toBe(messages);
    expect(bounded[0].id).toBe("session-digest");
    expect(totalModelChars(bounded)).toBeLessThanOrEqual(10_000);
  });

  it("keeps digest + a tool-heavy recent tail within the char budget", () => {
    const older = [
      { id: "o1", role: "user", content: "a".repeat(8000) },
      { id: "o2", role: "assistant", content: "b".repeat(8000) },
    ];
    const recent = Array.from({ length: 6 }, (_, i) => toolResultMessage(`r${i}`, 6000));
    const messages = [...older, ...recent];

    const bounded = prepareBoundedSessionContext(messages, {
      charBudget: 28_000,
      recentCount: 6,
      digestMaxChars: 14_000,
    });

    expect(totalModelChars(bounded)).toBeLessThanOrEqual(28_000);
  });

  it("truncates a single string message that alone exceeds the budget", () => {
    const messages = [{ id: "1", role: "user", content: "x".repeat(50_000) }];

    const bounded = prepareBoundedSessionContext(messages, {
      charBudget: 5_000,
      recentCount: 6,
    });

    expect(bounded).toHaveLength(1);
    expect(typeof bounded[0].content).toBe("string");
    expect(totalModelChars(bounded)).toBeLessThanOrEqual(5_000);
  });

  it("truncates a single oversized tool message to the budget", () => {
    const messages = [toolResultMessage("1", 50_000)];

    const bounded = prepareBoundedSessionContext(messages, {
      charBudget: 5_000,
      recentCount: 6,
    });

    expect(totalModelChars(bounded)).toBeLessThanOrEqual(5_000);
  });

  it("keeps an oversized tool message structured instead of collapsing it to text", () => {
    // Collapsing to a JSON-fragment string would orphan paired tool messages.
    const messages = [toolResultMessage("1", 50_000)];

    const bounded = prepareBoundedSessionContext(messages, {
      charBudget: 5_000,
      recentCount: 6,
    });

    const content = bounded[0].content as Array<{
      type?: string;
      toolInvocation?: { toolName?: string };
    }>;
    expect(Array.isArray(content)).toBe(true);
    expect(content[0].type).toBe("tool-invocation");
    expect(content[0].toolInvocation?.toolName).toBe("fetchPage");
    expect(totalModelChars(bounded)).toBeLessThanOrEqual(5_000);
  });

  it("drops oldest parts of a multi-part tool message to fit the budget", () => {
    const part = (callId: string, len: number) => ({
      type: "tool-invocation",
      toolInvocation: {
        toolName: "fetchPage",
        toolCallId: callId,
        state: "result",
        result: { markdown: "m".repeat(len), url: "https://example.com" },
      },
    });
    const messages = [
      { id: "1", role: "assistant", content: [part("a", 3_000), part("b", 3_000), part("c", 3_000)] },
    ];

    const bounded = prepareBoundedSessionContext(messages, {
      charBudget: 4_000,
      recentCount: 6,
    });

    const content = bounded[0].content as unknown[];
    expect(Array.isArray(content)).toBe(true);
    expect(content.length).toBeLessThan(3);
    expect(totalModelChars(bounded)).toBeLessThanOrEqual(4_000);
  });

  it("drops oldest messages when everything is recent but still over budget", () => {
    const messages = [
      { id: "1", role: "user", content: "a".repeat(400) },
      { id: "2", role: "assistant", content: "b".repeat(400) },
      { id: "3", role: "user", content: "c".repeat(400) },
    ];

    const bounded = prepareBoundedSessionContext(messages, {
      charBudget: 500,
      recentCount: 3,
    });

    expect(bounded.length).toBeLessThan(messages.length);
    expect(totalModelChars(bounded)).toBeLessThanOrEqual(500);
  });
});

describe("buildPriorChatDigestMessage", () => {
  it("returns null for an empty prior thread", () => {
    expect(buildPriorChatDigestMessage([])).toBeNull();
  });

  it("labels prior session turns for cross-chat continuity", () => {
    const digest = buildPriorChatDigestMessage([
      { id: "1", role: "user", content: "Plan my study session." },
      { id: "2", role: "assistant", content: "Hour 1: review chapter 2." },
    ]);
    expect(digest?.role).toBe("user");
    expect(String(digest?.content)).toContain("Prior chat digest");
    expect(String(digest?.content)).toContain("Hour 1");
  });
});

describe("resolveMaxContextMessages", () => {
  const original = process.env.CHAT_MAX_CONTEXT_MESSAGES;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.CHAT_MAX_CONTEXT_MESSAGES;
    } else {
      process.env.CHAT_MAX_CONTEXT_MESSAGES = original;
    }
  });

  it("defaults to 20 when env is unset", () => {
    delete process.env.CHAT_MAX_CONTEXT_MESSAGES;
    expect(resolveMaxContextMessages()).toBe(20);
  });
});

describe("resolveSessionCharBudget", () => {
  it("defaults to 28_000 when env is unset", () => {
    expect(resolveSessionCharBudget()).toBe(28_000);
  });
});
