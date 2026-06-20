// @vitest-environment node
// Route tests for smart course RAG gate (#484 + research grounding).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: vi.fn(),
    createDataStreamResponse: vi.fn(({ execute }) => {
      const chunks: string[] = [];
      const dataStream = { write: (part: string) => { chunks.push(part); } };
      execute(dataStream);
      return new Response(chunks.join(""), { status: 200 });
    }),
    formatDataStreamPart: vi.fn((_type: string, value: unknown) => String(value)),
    tool: vi.fn((definition: unknown) => definition),
  };
});

vi.mock("~/lib/ai/embedding", () => ({
  findRelevantContent: vi.fn().mockResolvedValue([]),
  generateEmbedding: vi.fn().mockResolvedValue([]),
  processMaterialEmbeddings: vi.fn(),
}));

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

vi.mock("~/lib/ai/providers.server", () => ({
  modelSupportsTools: vi.fn().mockResolvedValue(false),
}));

vi.mock("~/lib/assistive-events.server", () => ({
  recordResponseComplianceEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/ai/adhd-oversight", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/ai/adhd-oversight")>();
  return { ...actual, auditAndMaybeRewrite: vi.fn() };
});

vi.mock("~/lib/system-config.server", () => ({
  getWebToolsEnabled: vi.fn().mockResolvedValue(false),
  invalidateWebToolsCache: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    chat: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    chatMessage: { findMany: vi.fn(), createMany: vi.fn() },
    course: { findFirst: vi.fn() },
    systemConfig: { findUnique: vi.fn() },
  },
}));

import { streamText } from "ai";
import { action } from "~/routes/api/chat";
import { auth } from "~/lib/auth/server";
import { findRelevantContent } from "~/lib/ai/embedding";
import { modelSupportsTools } from "~/lib/ai/providers.server";
import prisma from "~/lib/prisma.server";

const CHAT_ID = "cjld2cjxh0000qzrmn831i7rn";
const COURSE_ID = "course-1";

function makeRequest(body: object) {
  return {
    request: new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: {},
    context: {} as never,
  };
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

function baseBody(overrides: Record<string, unknown> = {}) {
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

function lastStreamSystem(): string {
  const call = vi.mocked(streamText).mock.calls.at(-1)?.[0] as { system?: string } | undefined;
  return call?.system ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.CHAT_HYBRID_RAG_ALWAYS_WITH_COURSE;
  process.env.VLLM_BASE_URL = "http://localhost:8001";

  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "user-1", role: "STUDENT" },
  } as never);

  vi.mocked(prisma.chat.findFirst).mockResolvedValue({
    id: CHAT_ID,
    userId: "user-1",
    adhdAssist: false,
    systemPrompt: null,
  } as never);

  vi.mocked(prisma.chatMessage.findMany).mockResolvedValue([]);
  vi.mocked(prisma.chatMessage.createMany).mockResolvedValue({ count: 1 });
  vi.mocked(prisma.systemConfig.findUnique).mockResolvedValue(null);
});

describe("Smart course RAG gate (#484)", () => {
  describe("hybrid path (supportsTools = false)", () => {
    beforeEach(() => {
      vi.mocked(modelSupportsTools).mockResolvedValue(false);
    });

    it("prefetches but does not inject for generic queries with weak hits", async () => {
      vi.mocked(findRelevantContent).mockResolvedValue([
        { content: "noise", similarity: 0.2, materialTitle: "Doc" },
      ]);
      mockStream();
      const res = await action(makeRequest(baseBody()));
      expect(res.status).toBe(200);
      expect(findRelevantContent).toHaveBeenCalled();
      expect(lastStreamSystem()).not.toContain("Course grounding rules");
    });

    it("injects grounding block for course-intent queries", async () => {
      vi.mocked(findRelevantContent).mockResolvedValue([
        { content: "Trees are hierarchical.", similarity: 0.7, materialTitle: "Ch 3" },
      ]);
      mockStream();
      const res = await action(
        makeRequest(baseBody({
          messages: [{ id: "msg-1", role: "user", content: "What did chapter 3 say about trees?" }],
        })),
      );
      expect(res.status).toBe(200);
      expect(lastStreamSystem()).toContain("Course grounding rules");
      expect(lastStreamSystem()).toContain("Trees are hierarchical.");
    });

    it("prefetches but skips inject for greetings with weak hits", async () => {
      vi.mocked(findRelevantContent).mockResolvedValue([]);
      mockStream();
      const res = await action(
        makeRequest(baseBody({
          messages: [{ id: "msg-1", role: "user", content: "Hello!" }],
        })),
      );
      expect(res.status).toBe(200);
      expect(findRelevantContent).toHaveBeenCalled();
      expect(lastStreamSystem()).not.toContain("Course grounding rules");
    });

    it("injects on strong similarity even for generic phrasing", async () => {
      vi.mocked(findRelevantContent).mockResolvedValue([
        { content: "Gradient descent minimizes loss.", similarity: 0.85, materialTitle: "Notes" },
      ]);
      mockStream();
      const res = await action(makeRequest(baseBody()));
      expect(res.status).toBe(200);
      expect(lastStreamSystem()).toContain("Gradient descent minimizes loss.");
    });

    it("injects empty-material instruction when course-intent query has no hits", async () => {
      vi.mocked(findRelevantContent).mockResolvedValue([]);
      mockStream();
      const res = await action(
        makeRequest(baseBody({
          messages: [{ id: "msg-1", role: "user", content: "What did chapter 3 say about trees?" }],
        })),
      );
      expect(res.status).toBe(200);
      expect(lastStreamSystem()).toContain("did not return relevant excerpts");
      expect(lastStreamSystem()).not.toContain("Course grounding rules");
    });

    it("does not prefetch when no course is selected", async () => {
      mockStream();
      const res = await action(makeRequest(baseBody({ courseId: undefined })));
      expect(res.status).toBe(200);
      expect(findRelevantContent).not.toHaveBeenCalled();
    });
  });

  describe("tool path (supportsTools = true)", () => {
    beforeEach(() => {
      vi.mocked(modelSupportsTools).mockResolvedValue(true);
    });

    it("preloads only when inject gate passes", async () => {
      vi.mocked(findRelevantContent).mockResolvedValue([]);
      mockStream();
      const res = await action(makeRequest(baseBody()));
      expect(res.status).toBe(200);
      expect(findRelevantContent).toHaveBeenCalled();
      expect(lastStreamSystem()).not.toContain("Course grounding rules");
    });

    it("preloads grounding for course-intent queries", async () => {
      vi.mocked(findRelevantContent).mockResolvedValue([
        { content: "Late work loses 10%.", similarity: 0.72, materialTitle: "Syllabus" },
      ]);
      mockStream();
      const res = await action(
        makeRequest(baseBody({
          messages: [{ id: "msg-1", role: "user", content: "What does the syllabus say about late work?" }],
        })),
      );
      expect(res.status).toBe(200);
      expect(lastStreamSystem()).toContain("Late work loses 10%");
      expect(lastStreamSystem()).toContain("getInformation");
    });
  });
});
