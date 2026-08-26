// @vitest-environment node
// Route tests for smart course RAG gate (#484 + research grounding).
import type { JsonObject, JsonValue } from "~/lib/json-value";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { RouteRequestBody } from "../helpers/route-fixtures";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: vi.fn(),
    createDataStreamResponse: vi.fn(({ execute }) => {
      const chunks: string[] = [];
      const dataStream = {
        write: (part: string) => {
          chunks.push(part);
        },
      };
      execute(dataStream);
      return new Response(chunks.join(""), { status: 200 });
    }),
    formatDataStreamPart: vi.fn((_type: string, value: JsonValue) => String(value)),
    tool: vi.fn(<T>(definition: T) => definition),
  };
});

vi.mock("~/lib/ai/embedding", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/ai/embedding")>();
  return {
    ...actual,
    findRelevantContent: vi.fn().mockResolvedValue([]),
    generateEmbedding: vi.fn().mockResolvedValue([]),
    processMaterialEmbeddings: vi.fn(),
  };
});

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/guards.server", () => ({
  enforceAdminIfApiKey: vi.fn().mockResolvedValue({ response: null, session: null }),
}));

vi.mock("~/lib/auth/course-access.server", () => ({
  resolveCourseAccessWithCourse: vi.fn().mockResolvedValue({
    course: { id: "course-1", isPublished: true, code: "COSC101" },
    access: { level: "student" },
  }),
}));

vi.mock("~/lib/ai/providers.server", async () => {
  const actual = await vi.importActual<typeof import("~/lib/ai/providers.server")>(
    "~/lib/ai/providers.server",
  );
  return {
    ...actual,
    getChatModelCapabilities: vi.fn().mockResolvedValue({
      supportsTools: false,
      supportsImages: false,
      maxTokens: null,
      name: null,
    }),
    modelSupportsTools: vi.fn().mockResolvedValue(false),
    // Delegates to the real resolver by default; a test can force a tiny window
    // (via mockReturnValueOnce) to exercise the fail-closed fit check (#1643).
    resolveModelContextWindow: vi.fn(actual.resolveModelContextWindow),
  };
});

vi.mock("~/lib/assistive-events.server", () => ({
  recordResponseComplianceEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/ai/adhd-oversight", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/ai/adhd-oversight")>();
  return { ...actual, auditAndMaybeRewrite: vi.fn() };
});

vi.mock("~/lib/policy.server", () => ({
  getPolicy: vi.fn().mockResolvedValue(false),
  invalidatePolicyCache: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    chat: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    chatMessage: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn(), createMany: vi.fn() },
    course: { findFirst: vi.fn() },
    systemConfig: { findUnique: vi.fn() },
  },
}));

vi.mock("~/lib/user-provider-settings.server", () => ({
  getUserProviderSettings: vi.fn().mockResolvedValue({}),
}));

import { streamText } from "ai";
import { action } from "~/routes/api/chat";
import { auth } from "~/lib/auth/server";
import { EmbeddingRequestTimeoutError, findRelevantContent } from "~/lib/ai/embedding";
import { getChatModelCapabilities, resolveModelContextWindow } from "~/lib/ai/providers.server";
import { auditAndMaybeRewrite } from "~/lib/ai/adhd-oversight";
import { computeAdhdResponseMetrics, withStructuralPass } from "~/lib/ai/adhd-metrics";
import { recordResponseComplianceEvent } from "~/lib/assistive-events.server";
import { resetRateLimitsForTests } from "~/lib/auth/rate-limit.server";
import prisma from "~/lib/prisma.server";

const CHAT_ID = "cjld2cjxh0000qzrmn831i7rn";
const COURSE_ID = "course-1";

function makeRequest(body: RouteRequestBody) {
  return {
    request: new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: {},
    context: {} as never,
  } as any;
}

function mockStream() {
  vi.mocked(streamText).mockResolvedValue({
    consumeStream: vi.fn().mockResolvedValue(undefined),
    text: Promise.resolve("The answer."),
    usage: Promise.resolve({ promptTokens: 5, completionTokens: 10 }),
    finishReason: Promise.resolve("stop"),
    sources: Promise.resolve([]),
    reasoning: Promise.resolve(undefined),
    response: Promise.resolve({
      id: "resp-1",
      messages: [{ id: "msg-1", role: "assistant", content: "The answer." }],
    }),
  } as never);
}

function baseBody(overrides: JsonObject = {}) {
  return {
    messages: [{ id: "msg-1", role: "user", content: "What is gradient descent?" }],
    model: "vllm:test-model",
    apiKeys: {},
    streaming: false,
    chatId: CHAT_ID,
    courseId: COURSE_ID,
    ...overrides,
  };
}

function lastStreamConfig(): {
  system?: string;
  maxTokens?: number;
  messages?: Array<{ id?: string }>;
} {
  const call = vi.mocked(streamText).mock.calls.at(-1)?.[0] as
    | { system?: string; maxTokens?: number; messages?: Array<{ id?: string }> }
    | undefined;
  return call ?? {};
}

function lastStreamMessages(): Array<{ id?: string }> {
  return lastStreamConfig().messages ?? [];
}

function storedRecord(id: string, role: string, content: string) {
  return {
    messageId: id,
    role,
    content: { id, role, content },
    position: 0,
  };
}

/** DB returns newest-first; the route reverses to chronological order. */
function storedRecordsDesc(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const idx = count - 1 - i;
    return storedRecord(`stored-${idx}`, idx % 2 === 0 ? "user" : "assistant", `turn-${idx}`);
  });
}

function mockAuditResult(text: string = "Audited reply.") {
  const metrics = withStructuralPass(computeAdhdResponseMetrics(text));
  vi.mocked(auditAndMaybeRewrite).mockResolvedValue({
    text,
    rewritten: false,
    method: "none",
    beforeMetrics: metrics,
    afterMetrics: metrics,
    oversightDurationMs: 0,
    oversightUsage: null,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimitsForTests();
  delete process.env.CHAT_HYBRID_RAG_ALWAYS_WITH_COURSE;
  process.env.VLLM_BASE_URL = "http://localhost:8001";
  // Pin the message-load ceiling so the #225 RAG-11 cap assertions stay exact;
  // the default was raised to 100 (#1639) and is covered in chat-rag.test.ts.
  process.env.CHAT_MAX_CONTEXT_MESSAGES = "20";

  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "user-1", role: "STUDENT" },
  } as never);

  vi.mocked(prisma.chat.findFirst).mockResolvedValue({
    id: CHAT_ID,
    userId: "user-1",
    courseId: COURSE_ID,
    adhdAssist: false,
    systemPrompt: null,
  } as never);

  vi.mocked(prisma.chat.update).mockImplementation((async (args: { data?: JsonObject }) => ({
    id: CHAT_ID,
    userId: "user-1",
    courseId: COURSE_ID,
    adhdAssist: false,
    systemPrompt: null,
    ...args.data,
  })) as never);

  vi.mocked(prisma.chatMessage.findMany).mockResolvedValue([]);
  vi.mocked(prisma.chatMessage.createMany).mockResolvedValue({ count: 1 });
  vi.mocked(prisma.systemConfig.findUnique).mockResolvedValue(null);
});

describe("Smart course RAG gate (#484)", () => {
  describe("hybrid path (supportsTools = false)", () => {
    beforeEach(() => {
      vi.mocked(getChatModelCapabilities).mockResolvedValue({
        supportsTools: false,
        supportsImages: false,
        maxTokens: null,
        name: null,
      });
    });

    it("prefetches but does not inject for generic queries with weak hits", async () => {
      vi.mocked(findRelevantContent).mockResolvedValue([
        { content: "noise", similarity: 0.2, materialTitle: "Doc" },
      ]);
      mockStream();
      const res = await action(makeRequest(baseBody()));
      expect(res.status).toBe(200);
      expect(findRelevantContent).toHaveBeenCalled();
      expect(lastStreamConfig().system).not.toContain("Course grounding rules");
    });

    it("injects grounding block for course-intent queries", async () => {
      vi.mocked(findRelevantContent).mockResolvedValue([
        { content: "Trees are hierarchical.", similarity: 0.7, materialTitle: "Ch 3" },
      ]);
      mockStream();
      const res = await action(
        makeRequest(
          baseBody({
            messages: [
              { id: "msg-1", role: "user", content: "What did chapter 3 say about trees?" },
            ],
          }),
        ),
      );
      expect(res.status).toBe(200);
      expect(lastStreamConfig().system).toContain("Course grounding rules");
      expect(lastStreamConfig().system).toContain("Trees are hierarchical.");
    });

    it("prefetches but skips inject for greetings with weak hits", async () => {
      vi.mocked(findRelevantContent).mockResolvedValue([]);
      mockStream();
      const res = await action(
        makeRequest(
          baseBody({
            messages: [{ id: "msg-1", role: "user", content: "Hello!" }],
          }),
        ),
      );
      expect(res.status).toBe(200);
      expect(findRelevantContent).toHaveBeenCalled();
      expect(lastStreamConfig().system).not.toContain("Course grounding rules");
    });

    it("injects on strong similarity even for generic phrasing", async () => {
      vi.mocked(findRelevantContent).mockResolvedValue([
        { content: "Gradient descent minimizes loss.", similarity: 0.85, materialTitle: "Notes" },
      ]);
      mockStream();
      const res = await action(makeRequest(baseBody()));
      expect(res.status).toBe(200);
      expect(lastStreamConfig().system).toContain("Gradient descent minimizes loss.");
    });

    it("injects empty-material instruction when course-intent query has no hits", async () => {
      vi.mocked(findRelevantContent).mockResolvedValue([]);
      mockStream();
      const res = await action(
        makeRequest(
          baseBody({
            messages: [
              { id: "msg-1", role: "user", content: "What did chapter 3 say about trees?" },
            ],
          }),
        ),
      );
      expect(res.status).toBe(200);
      expect(lastStreamConfig().system).toContain("did not return relevant excerpts");
      expect(lastStreamConfig().system).not.toContain("Course grounding rules");
    });

    it("fails closed with RAG_DIMENSION_MISMATCH when retrieval throws for a course-intent query (#225 RAG-01)", async () => {
      vi.mocked(findRelevantContent).mockRejectedValue(
        new Error("Embedding dimension mismatch in generateEmbedding: got 768, expected 1024."),
      );
      const res = await action(
        makeRequest(
          baseBody({
            messages: [
              { id: "msg-1", role: "user", content: "What did chapter 3 say about trees?" },
            ],
          }),
        ),
      );
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.code).toBe("RAG_DIMENSION_MISMATCH");
      expect(streamText).not.toHaveBeenCalled();
    });

    it("fails closed with RAG_RETRIEVAL_FAILED when the embedding provider is down for a course-intent query (#225 RAG-02)", async () => {
      vi.mocked(findRelevantContent).mockRejectedValue(
        new Error("Local embedding provider failed (mxbai-embed-large). fetch failed"),
      );
      const res = await action(
        makeRequest(
          baseBody({
            messages: [
              { id: "msg-1", role: "user", content: "What did chapter 3 say about trees?" },
            ],
          }),
        ),
      );
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.code).toBe("RAG_RETRIEVAL_FAILED");
      expect(streamText).not.toHaveBeenCalled();
    });

    it("fails closed with RAG_RETRIEVAL_TIMEOUT when the embedding deadline expires", async () => {
      vi.mocked(findRelevantContent).mockRejectedValue(new EmbeddingRequestTimeoutError(100));
      const res = await action(
        makeRequest(
          baseBody({
            messages: [{ id: "msg-1", role: "user", content: "What did chapter 3 say?" }],
          }),
        ),
      );
      expect(res.status).toBe(503);
      expect((await res.json()).code).toBe("RAG_RETRIEVAL_TIMEOUT");
      expect(streamText).not.toHaveBeenCalled();
    });

    it("fails closed on prefetch failure even when intent heuristics skip grounding (#225 RAG-01/RAG-02)", async () => {
      vi.mocked(findRelevantContent).mockRejectedValue(new Error("Embedding dimension mismatch"));
      const res = await action(
        makeRequest(
          baseBody({
            messages: [{ id: "msg-1", role: "user", content: "Explain polymorphism" }],
          }),
        ),
      );
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.code).toBe("RAG_DIMENSION_MISMATCH");
      expect(streamText).not.toHaveBeenCalled();
    });

    it("fails closed on prefetch failure for a greeting that would otherwise skip inject", async () => {
      vi.mocked(findRelevantContent).mockRejectedValue(new Error("Embedding dimension mismatch"));
      const res = await action(
        makeRequest(
          baseBody({
            messages: [{ id: "msg-1", role: "user", content: "Hello!" }],
          }),
        ),
      );
      expect(res.status).toBe(503);
      expect(streamText).not.toHaveBeenCalled();
    });

    it("does not prefetch when no course is selected", async () => {
      vi.mocked(prisma.chat.findFirst).mockResolvedValue({
        id: CHAT_ID,
        userId: "user-1",
        courseId: null,
        adhdAssist: false,
        systemPrompt: null,
      } as never);
      mockStream();
      const res = await action(makeRequest(baseBody({ courseId: undefined })));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "COURSE_REQUIRED" });
      expect(findRelevantContent).not.toHaveBeenCalled();
    });

    it("prefetches whitespace-only user text but skips RAG inject (#225 RAG-10)", async () => {
      vi.mocked(findRelevantContent).mockResolvedValue([]);
      mockStream();
      const res = await action(
        makeRequest(
          baseBody({
            messages: [{ id: "msg-1", role: "user", content: "   " }],
          }),
        ),
      );
      expect(res.status).toBe(200);
      expect(findRelevantContent).toHaveBeenCalledWith(
        "   ",
        COURSE_ID,
        expect.any(Number),
        undefined,
        expect.any(Boolean),
        { signal: expect.any(AbortSignal) },
      );
      expect(lastStreamConfig().system).not.toContain("Course grounding rules");
      expect(lastStreamConfig().system).not.toContain("did not return relevant excerpts");
    });

    it("keeps all 20 merged turns when at the context message cap (#225 RAG-11)", async () => {
      vi.mocked(prisma.chatMessage.findMany).mockResolvedValue(storedRecordsDesc(19) as never);
      vi.mocked(findRelevantContent).mockResolvedValue([]);
      mockStream();

      await action(
        makeRequest(
          baseBody({
            messages: [{ id: "incoming-19", role: "user", content: "latest" }],
          }),
        ),
      );

      const ids = lastStreamMessages().map((m) => m.id);
      expect(ids).toHaveLength(20);
      expect(ids[0]).toBe("stored-0");
      expect(ids[19]).toBe("incoming-19");
    });

    it("drops the oldest turn over the cap but discloses it in a marker (#225 RAG-11, #1643)", async () => {
      vi.mocked(prisma.chatMessage.findMany).mockResolvedValue(storedRecordsDesc(20) as never);
      vi.mocked(prisma.chatMessage.count).mockResolvedValue(20);
      vi.mocked(findRelevantContent).mockResolvedValue([]);
      mockStream();

      await action(
        makeRequest(
          baseBody({
            messages: [{ id: "incoming-20", role: "user", content: "latest" }],
          }),
        ),
      );

      const messages = lastStreamMessages();
      const ids = messages.map((m) => m.id);
      // The oldest turn is still dropped, but the model is told rather than
      // losing it in silence: a digest marker leads the context (#1643).
      expect(ids[0]).toBe("session-digest");
      expect(ids).not.toContain("stored-0");
      expect(ids[ids.length - 1]).toBe("incoming-20");
      const marker = messages[0] as { content?: unknown };
      expect(typeof marker.content === "string" ? marker.content : "").toMatch(
        /1 earlier turn omitted/,
      );
    });

    it("does not persist incoming turns that were trimmed from the model context", async () => {
      vi.mocked(findRelevantContent).mockResolvedValue([]);
      mockStream();
      const incoming = Array.from({ length: 21 }, (_, index) => ({
        id: `incoming-${index}`,
        role: "user",
        content: `turn-${index}`,
      }));

      const res = await action(makeRequest(baseBody({ messages: incoming })));

      expect(res.status).toBe(200);
      const firstPersistCall = vi.mocked(prisma.chatMessage.createMany).mock.calls[0]?.[0];
      const persisted = Array.isArray(firstPersistCall?.data) ? firstPersistCall.data : [];
      expect(persisted).toHaveLength(20);
      expect(persisted.map((row) => row.messageId)).not.toContain("incoming-0");
      expect(persisted.map((row) => row.messageId)).toContain("incoming-20");
    });
  });

  describe("tool path (supportsTools = true)", () => {
    beforeEach(() => {
      process.env.VLLM_CHAT_TOOLS = "1";
      vi.mocked(getChatModelCapabilities).mockResolvedValue({
        supportsTools: true,
        supportsImages: false,
        maxTokens: 8192,
        name: "Test tool model",
      });
    });

    it("caps tool-path maxTokens against model maxTokens", async () => {
      vi.mocked(findRelevantContent).mockResolvedValue([]);
      mockStream();
      const res = await action(makeRequest(baseBody()));
      expect(res.status).toBe(200);
      expect(lastStreamConfig().maxTokens).toBe(8192);
    });

    it("preloads only when inject gate passes", async () => {
      vi.mocked(findRelevantContent).mockResolvedValue([]);
      mockStream();
      const res = await action(makeRequest(baseBody()));
      expect(res.status).toBe(200);
      expect(findRelevantContent).toHaveBeenCalled();
      expect(lastStreamConfig().system).not.toContain("Course grounding rules");
    });

    it("preloads grounding for course-intent queries", async () => {
      vi.mocked(findRelevantContent).mockResolvedValue([
        { content: "Late work loses 10%.", similarity: 0.72, materialTitle: "Syllabus" },
      ]);
      mockStream();
      const res = await action(
        makeRequest(
          baseBody({
            messages: [
              { id: "msg-1", role: "user", content: "What does the syllabus say about late work?" },
            ],
          }),
        ),
      );
      expect(res.status).toBe(200);
      expect(lastStreamConfig().system).toContain("Late work loses 10%");
      expect(lastStreamConfig().system).toContain("getInformation");
    });

    it("fails closed on the tool path too when retrieval throws for a course-intent query (#225 RAG-01)", async () => {
      vi.mocked(findRelevantContent).mockRejectedValue(
        new Error("Embedding dimension mismatch in generateEmbedding: got 768, expected 1024."),
      );
      const res = await action(
        makeRequest(
          baseBody({
            messages: [
              { id: "msg-1", role: "user", content: "What does the syllabus say about late work?" },
            ],
          }),
        ),
      );
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.code).toBe("RAG_DIMENSION_MISMATCH");
      expect(streamText).not.toHaveBeenCalled();
    });
  });

  describe("ADHD Assist citation telemetry from hybrid/preloaded RAG (#722 review)", () => {
    const originalOversight = process.env.ADHD_ASSIST_OVERSIGHT;

    beforeEach(() => {
      vi.mocked(getChatModelCapabilities).mockResolvedValue({
        supportsTools: false,
        supportsImages: false,
        maxTokens: null,
        name: null,
      });
      process.env.ADHD_ASSIST_OVERSIGHT = "true";
      vi.mocked(prisma.chat.findFirst).mockResolvedValue({
        id: CHAT_ID,
        userId: "user-1",
        courseId: COURSE_ID,
        adhdAssist: true,
        systemPrompt: null,
      } as never);
      mockAuditResult();
    });

    afterEach(() => {
      if (originalOversight === undefined) delete process.env.ADHD_ASSIST_OVERSIGHT;
      else process.env.ADHD_ASSIST_OVERSIGHT = originalOversight;
    });

    it("marks toolsUsed when hybrid RAG context is injected with no tool call", async () => {
      vi.mocked(findRelevantContent).mockResolvedValue([
        { content: "Trees are hierarchical.", similarity: 0.7, materialTitle: "Ch 3" },
      ]);
      mockStream();
      const res = await action(
        makeRequest(
          baseBody({
            adhdAssist: true,
            messages: [
              { id: "msg-1", role: "user", content: "What did chapter 3 say about trees?" },
            ],
          }),
        ),
      );
      expect(res.status).toBe(200);
      expect(recordResponseComplianceEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          extras: expect.objectContaining({ toolsUsed: true }),
        }),
      );
    });

    it("leaves toolsUsed false when no RAG context was injected", async () => {
      vi.mocked(findRelevantContent).mockResolvedValue([]);
      mockStream();
      const res = await action(
        makeRequest(
          baseBody({
            adhdAssist: true,
            messages: [{ id: "msg-1", role: "user", content: "What is gradient descent?" }],
          }),
        ),
      );
      expect(res.status).toBe(200);
      expect(recordResponseComplianceEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          extras: expect.objectContaining({ toolsUsed: false }),
        }),
      );
    });
  });
});

describe("token-budget context window — pre-digest omissions and fail-closed fit (#1643)", () => {
  function firstMessageContent(): string {
    const first = lastStreamMessages()[0] as { id?: string; content?: unknown };
    return typeof first?.content === "string" ? first.content : "";
  }

  it("discloses turns older than the load ceiling in the digest marker, not silently", async () => {
    // Load ceiling pinned to 20 (beforeEach), but the chat holds 250 stored
    // turns. The 230+ older turns cut before the digest must be marked so the
    // model is told history was truncated — never dropped in silence.
    vi.mocked(prisma.chatMessage.findMany).mockResolvedValue(storedRecordsDesc(20) as never);
    vi.mocked(prisma.chatMessage.count).mockResolvedValue(250);
    vi.mocked(findRelevantContent).mockResolvedValue([]);
    mockStream();
    mockAuditResult("The answer.");

    const res = await action(makeRequest(baseBody()));
    expect(res.status).toBe(200);

    const messages = lastStreamMessages();
    expect(messages[0]?.id).toBe("session-digest");
    // 230 never-loaded + 1 cut by the merge tail-slice = 231 disclosed.
    expect(firstMessageContent()).toMatch(/231 earlier turns omitted/);
  });

  it("fails closed for a non-admin chat whose prompt cannot fit the window", async () => {
    // Force a tiny context window: after the security block is composed, the
    // fixed prompt + minimum completion no longer fit. Non-admin used to send
    // this over-context request; it now returns a clean 400 instead.
    vi.mocked(resolveModelContextWindow).mockReturnValueOnce(512);
    vi.mocked(findRelevantContent).mockResolvedValue([]);
    mockStream();

    const res = await action(makeRequest(baseBody()));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ code: "CONTEXT_TOO_LARGE" });
    expect(streamText).not.toHaveBeenCalled();
  });
});
