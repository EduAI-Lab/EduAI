import type { JsonObject } from "~/lib/json-value";
import { describe, it, expect, afterEach } from "vitest";
import {
  buildCappedRagContextText,
  buildRagAnswerInstructions,
  buildRagSystemBlock,
  buildEmptyCourseRagBlock,
  capRagHitsForTool,
  capToolResultsInMessages,
  estimateMessageCharsForModel,
  messageHasImageParts,
  prepareBoundedSessionContext,
  resolveMaxContextMessages,
  resolveMaxDigestSourceMessages,
  resolveSessionRecentMessages,
  resolveSessionCharBudget,
  resolveToolResultMaxChars,
  truncateToMaxChars,
  RAG_COURSE_GROUNDING_INSTRUCTION,
  UNTRUSTED_RAG_OPEN,
  UNTRUSTED_RAG_CLOSE,
  HYBRID_RAG_MAX_CHUNKS,
  HYBRID_RAG_MAX_CONTEXT_CHARS,
  TOOL_RAG_MAX_CHARS_PER_CHUNK,
  HYBRID_RAG_MIN_TRUNCATE_CHARS,
  type HybridRagHit,
} from "~/lib/chat-rag";

function hit(content: string, title = "Lecture 1"): HybridRagHit {
  return { content, similarity: 0.9, materialTitle: title };
}

describe("messageHasImageParts", () => {
  it("detects image parts in content and parts arrays", () => {
    expect(messageHasImageParts({ role: "user", content: "hello" })).toBe(false);
    expect(
      messageHasImageParts({
        role: "user",
        parts: [
          { type: "text", text: "see this" },
          { type: "image", image: "data:..." },
        ],
      }),
    ).toBe(true);
    expect(
      messageHasImageParts({
        role: "user",
        content: [{ type: "image_url", image_url: { url: "https://example.com/x.png" } }],
      }),
    ).toBe(true);
  });
});

describe("buildRagAnswerInstructions", () => {
  it("includes general grounding rules without course-specific examples", () => {
    const text = buildRagAnswerInstructions();
    expect(text).toContain(RAG_COURSE_GROUNDING_INSTRUCTION);
    expect(text).toContain("do not support that premise");
    expect(text).toContain("Cite the **Source** header");
    expect(text).not.toMatch(/Morocco|FIFA/i);
  });

  it("adds getInformation hint on tool path", () => {
    expect(buildRagAnswerInstructions({ toolPath: true })).toContain("getInformation");
    expect(buildRagAnswerInstructions()).not.toContain("getInformation");
  });
});

describe("buildRagSystemBlock", () => {
  it("wraps context with excerpt header and grounding suffix", () => {
    const block = buildRagSystemBlock("**Source**: Doc\nFact one.");
    expect(block).toContain("Here are relevant excerpts");
    expect(block).toContain("Fact one.");
    expect(block).toContain("Course grounding rules");
  });
});

describe("buildEmptyCourseRagBlock", () => {
  it("forbids substituting general knowledge when search returns nothing", () => {
    const block = buildEmptyCourseRagBlock();
    expect(block).toContain("did not return relevant excerpts");
    expect(block).toContain("Do not substitute general world knowledge");
  });
});

describe("buildCappedRagContextText", () => {
  it("returns empty string for no hits", () => {
    expect(buildCappedRagContextText([], 4, 1000)).toBe("");
  });

  it("includes source headers and joins chunks with separators", () => {
    const text = buildCappedRagContextText([hit("alpha"), hit("beta", "Reading 2")], 4, 10_000);
    expect(text).toContain("**Source**: Lecture 1");
    expect(text).toContain("alpha");
    expect(text).toContain("**Source**: Reading 2");
    expect(text).toContain("beta");
    expect(text).toContain("\n\n---\n\n");
  });

  it("limits to maxChunks even when more hits are provided", () => {
    const hits = [hit("chunk-one"), hit("chunk-two"), hit("chunk-three"), hit("chunk-four")];
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
    expect(text).toContain(UNTRUSTED_RAG_OPEN);
    expect(text).toContain("…");
    expect(text.length).toBeGreaterThan(maxChars);
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
    expect(capped[0].content).toContain("chunk-0");
    expect(capped[HYBRID_RAG_MAX_CHUNKS - 1].content).toContain(
      `chunk-${HYBRID_RAG_MAX_CHUNKS - 1}`,
    );
  });

  it("truncates content longer than TOOL_RAG_MAX_CHARS_PER_CHUNK", () => {
    const long = "z".repeat(TOOL_RAG_MAX_CHARS_PER_CHUNK + 100);
    const [capped] = capRagHitsForTool([hit(long)]);
    expect(capped.content).toContain(UNTRUSTED_RAG_OPEN);
    expect(capped.content).toContain("…");
  });

  it("wraps short content as untrusted reference", () => {
    const [capped] = capRagHitsForTool([hit("short")]);
    expect(capped.content).toContain(UNTRUSTED_RAG_OPEN);
    expect(capped.content).toContain("short");
    expect(capped.content).toContain(UNTRUSTED_RAG_CLOSE);
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
    const result = (
      capped[0].content as Array<{ toolInvocation: { result: { markdown: string } } }>
    )[0].toolInvocation.result.markdown;

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
function totalModelChars(messages: JsonObject[]): number {
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

  it("digest preserves middle and recent older topics, not just the earliest (#1639)", () => {
    // The regression: the old digest walked older turns earliest→latest then
    // tail-truncated, keeping the first topic and dropping the middle/recent
    // ones. With a generous digest cap every older topic must survive.
    const topics = Array.from({ length: 12 }, (_, i) => `TOPIC${i}`);
    const older = topics.map((topic, i) => ({
      id: `o${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Discussion about ${topic}: ${"x".repeat(300)}`,
    }));
    const messages = [
      ...older,
      { id: "r1", role: "user", content: "latest question" },
      { id: "r2", role: "assistant", content: "latest answer" },
    ];

    // charBudget below the ~3.8k of older content so the digest triggers, but
    // above the assembled digest so the tail is not further trimmed.
    const bounded = prepareBoundedSessionContext(messages, {
      charBudget: 3_000,
      recentCount: 2,
      digestMaxChars: 14_000,
    });

    expect(bounded[0].id).toBe("session-digest");
    const digest = String(bounded[0].content);
    for (const topic of topics) {
      expect(digest).toContain(topic);
    }
  });

  it("under a tiny digest cap samples across the span, anchoring oldest + newest (#1643)", () => {
    const topics = Array.from({ length: 10 }, (_, i) => `TOPIC${i}`);
    const older = topics.map((topic, i) => ({
      id: `o${i}`,
      role: "user",
      content: `About ${topic} ${"y".repeat(400)}`,
    }));
    const messages = [
      ...older,
      { id: "r1", role: "user", content: "latest" },
      { id: "r2", role: "assistant", content: "reply" },
    ];

    // charBudget below the ~4.1k of older content triggers the digest; the tiny
    // digestMaxChars then forces most older turns to be dropped.
    const bounded = prepareBoundedSessionContext(messages, {
      charBudget: 1_500,
      recentCount: 2,
      digestMaxChars: 400,
    });

    const digest = String(bounded[0].content);
    // The newest older topic is retained (nearest the current question)...
    expect(digest).toContain("TOPIC9");
    // ...the OLDEST is retained too — representative sampling anchors both ends
    // so a "summarize everything" request never loses the thread's origin (#1643)...
    expect(digest).toContain("TOPIC0");
    // ...a middle turn survives while adjacent ones are dropped (even spacing)...
    expect(digest).toContain("TOPIC5");
    expect(digest).not.toContain("TOPIC1");
    // ...and the omission is disclosed rather than silent.
    expect(digest).toMatch(/earlier turns? omitted/);
  });

  it("summarizes pre-extracted older content (priorOlderEntries), not just a count (#1643)", () => {
    // The loaded verbatim slice fits the budget, but 3 older turns beyond the
    // window were loaded as content. Their topics must appear in the digest.
    const messages = [
      { id: "r1", role: "user", content: "latest question" },
      { id: "r2", role: "assistant", content: "latest answer" },
    ];
    const bounded = prepareBoundedSessionContext(messages, {
      charBudget: 10_000,
      digestMaxChars: 14_000,
      priorOlderEntries: [
        { role: "user", text: "Earlier we discussed OLDTOPIC_ALPHA in depth" },
        { role: "assistant", text: "Then we covered OLDTOPIC_BETA" },
        { role: "user", text: "And finally OLDTOPIC_GAMMA" },
      ],
      priorOmittedCount: 40,
    });

    expect(bounded[0].id).toBe("session-digest");
    const digest = String(bounded[0].content);
    expect(digest).toContain("OLDTOPIC_ALPHA");
    expect(digest).toContain("OLDTOPIC_BETA");
    expect(digest).toContain("OLDTOPIC_GAMMA");
    // Turns beyond the loaded span are still disclosed as a count.
    expect(digest).toMatch(/40 earlier turns omitted/);
    // The loaded turns stay verbatim after the digest.
    expect(bounded.at(-2)?.content).toBe("latest question");
    expect(bounded.at(-1)?.content).toBe("latest answer");
  });

  it("discloses turns dropped before the digest, even when the loaded slice fits (#1643)", () => {
    // The loaded slice is small and well under budget, but 240 older turns were
    // cut before this call (DB load ceiling + tail-slice). They must be marked,
    // not silently lost.
    const messages = [
      { id: "r1", role: "user", content: "recent question" },
      { id: "r2", role: "assistant", content: "recent answer" },
    ];

    const bounded = prepareBoundedSessionContext(messages, {
      charBudget: 10_000,
      priorOmittedCount: 240,
    });

    expect(bounded).toHaveLength(3);
    expect(bounded[0].id).toBe("session-digest");
    expect(String(bounded[0].content)).toMatch(/240 earlier turns omitted/);
    // The loaded turns are kept verbatim after the marker.
    expect(bounded[1].content).toBe("recent question");
    expect(bounded[2].content).toBe("recent answer");
  });

  it("returns the loaded slice unchanged when nothing was dropped before it", () => {
    const messages = [
      { id: "r1", role: "user", content: "hi" },
      { id: "r2", role: "assistant", content: "hello" },
    ];
    expect(
      prepareBoundedSessionContext(messages, { charBudget: 10_000, priorOmittedCount: 0 }),
    ).toBe(messages);
  });

  it("folds pre-digest omissions into the digest's omitted count (#1643)", () => {
    const older = Array.from({ length: 6 }, (_, i) => ({
      id: `o${i}`,
      role: "user",
      content: `About TOPIC${i} ${"z".repeat(400)}`,
    }));
    const messages = [
      ...older,
      { id: "r1", role: "user", content: "latest" },
      { id: "r2", role: "assistant", content: "reply" },
    ];

    // Over budget so the digest triggers; a tiny digest cap forces some loaded
    // older turns to drop too. The marker must sum both drop sources.
    const bounded = prepareBoundedSessionContext(messages, {
      charBudget: 1_500,
      recentCount: 2,
      digestMaxChars: 300,
      priorOmittedCount: 200,
    });

    const digest = String(bounded[0].content);
    const match = digest.match(/\((\d+) earlier turns omitted/);
    expect(match).not.toBeNull();
    // At least the 200 prior omissions, plus however many loaded turns were cut.
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(200);
  });

  it("truncates a single string message that alone exceeds the budget", () => {
    const messages = [{ id: "1", role: "user", content: "x".repeat(50_000) }];

    const bounded = prepareBoundedSessionContext(messages, {
      charBudget: 5_000,
      recentCount: 6,
    });

    expect(bounded).toHaveLength(1);
    expect(bounded[0].content).toEqual(expect.any(String));
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
      {
        id: "1",
        role: "assistant",
        content: [part("a", 3_000), part("b", 3_000), part("c", 3_000)],
      },
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

  it("does not digest when total chars equal the 28k session budget exactly (#225 RAG-11)", () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      role: i % 2 === 0 ? "user" : "assistant",
      content: "x".repeat(1400),
    }));

    expect(totalModelChars(messages)).toBe(28_000);
    expect(prepareBoundedSessionContext(messages, { charBudget: 28_000 })).toBe(messages);
  });

  it("digests older turns when total chars exceed the 28k budget by one (#225 RAG-11)", () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      role: i % 2 === 0 ? "user" : "assistant",
      content: i === 19 ? "x".repeat(1401) : "x".repeat(1400),
    }));

    expect(totalModelChars(messages)).toBe(28_001);
    const bounded = prepareBoundedSessionContext(messages, {
      charBudget: 28_000,
      recentCount: 6,
      digestMaxChars: 14_000,
    });

    expect(bounded[0].id).toBe("session-digest");
    expect(totalModelChars(bounded)).toBeLessThanOrEqual(28_000);
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

  it("defaults to a generous load ceiling when env is unset (#1639)", () => {
    delete process.env.CHAT_MAX_CONTEXT_MESSAGES;
    // Raised from 20 so long threads reach the digest and get summarized rather
    // than dropped before the digest sees them; the token budget is the real cap.
    expect(resolveMaxContextMessages()).toBe(100);
  });
});

describe("resolveSessionCharBudget", () => {
  it("defaults to 28_000 when env is unset", () => {
    expect(resolveSessionCharBudget()).toBe(28_000);
  });
});

describe("resolveSessionRecentMessages", () => {
  const original = process.env.CHAT_SESSION_RECENT_MESSAGES;
  afterEach(() => {
    if (original === undefined) {
      delete process.env.CHAT_SESSION_RECENT_MESSAGES;
    } else {
      process.env.CHAT_SESSION_RECENT_MESSAGES = original;
    }
  });

  it("defaults to 6 when env is unset", () => {
    delete process.env.CHAT_SESSION_RECENT_MESSAGES;
    expect(resolveSessionRecentMessages()).toBe(6);
  });

  it("clamps the verbatim tail to its own 50 ceiling, not the 200 load ceiling (#1643)", () => {
    // .env.example documents the clamp as 2–50; the tail is bounded separately
    // from the DB load window so an oversized tail cannot defeat the digest.
    process.env.CHAT_SESSION_RECENT_MESSAGES = "200";
    expect(resolveSessionRecentMessages()).toBe(50);
  });
});

describe("resolveMaxDigestSourceMessages", () => {
  const original = process.env.CHAT_DIGEST_MAX_SOURCE_MESSAGES;
  afterEach(() => {
    if (original === undefined) {
      delete process.env.CHAT_DIGEST_MAX_SOURCE_MESSAGES;
    } else {
      process.env.CHAT_DIGEST_MAX_SOURCE_MESSAGES = original;
    }
  });

  it("defaults to 600 when env is unset (#1643)", () => {
    delete process.env.CHAT_DIGEST_MAX_SOURCE_MESSAGES;
    expect(resolveMaxDigestSourceMessages()).toBe(600);
  });

  it("clamps within [200, 2000] (#1643)", () => {
    process.env.CHAT_DIGEST_MAX_SOURCE_MESSAGES = "50";
    expect(resolveMaxDigestSourceMessages()).toBe(200);
    process.env.CHAT_DIGEST_MAX_SOURCE_MESSAGES = "9999";
    expect(resolveMaxDigestSourceMessages()).toBe(2_000);
  });
});
