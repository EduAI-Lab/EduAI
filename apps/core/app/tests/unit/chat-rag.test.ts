import { describe, it, expect, afterEach } from "vitest";
import {
  buildCappedRagContextText,
  capRagHitsForTool,
  capToolResultsInMessages,
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
