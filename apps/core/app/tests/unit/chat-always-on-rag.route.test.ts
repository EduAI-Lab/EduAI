// @vitest-environment node
// Tests for #484: course selected → RAG always runs on both hybrid and tool paths.
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

beforeEach(() => {
  vi.clearAllMocks();
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

describe("Always-on course RAG (#484)", () => {
  describe("hybrid path (supportsTools = false)", () => {
    beforeEach(() => {
      vi.mocked(modelSupportsTools).mockResolvedValue(false);
    });

    it("calls findRelevantContent for a generic query when course is selected", async () => {
      mockStream();
      const res = await action(makeRequest(baseBody()));
      expect(res.status).toBe(200);
      expect(findRelevantContent).toHaveBeenCalledWith(
        expect.any(String),
        COURSE_ID,
        expect.any(Number),
      );
    });

    it("does not call findRelevantContent when no course is selected", async () => {
      mockStream();
      const res = await action(makeRequest(baseBody({ courseId: undefined })));
      expect(res.status).toBe(200);
      expect(findRelevantContent).not.toHaveBeenCalled();
    });

    it("calls findRelevantContent for a greeting-style query when course is selected", async () => {
      mockStream();
      const res = await action(
        makeRequest(baseBody({
          messages: [{ id: "msg-1", role: "user", content: "Hello!" }],
        })),
      );
      expect(res.status).toBe(200);
      expect(findRelevantContent).toHaveBeenCalledWith(
        expect.any(String),
        COURSE_ID,
        expect.any(Number),
      );
    });
  });

  describe("tool path (supportsTools = true)", () => {
    beforeEach(() => {
      vi.mocked(modelSupportsTools).mockResolvedValue(true);
    });

    it("preloads findRelevantContent for a generic query when course is selected", async () => {
      mockStream();
      const res = await action(makeRequest(baseBody()));
      expect(res.status).toBe(200);
      expect(findRelevantContent).toHaveBeenCalledWith(
        expect.any(String),
        COURSE_ID,
        expect.any(Number),
      );
    });

    it("does not preload findRelevantContent when no course is selected", async () => {
      mockStream();
      const res = await action(makeRequest(baseBody({ courseId: undefined })));
      expect(res.status).toBe(200);
      expect(findRelevantContent).not.toHaveBeenCalled();
    });
  });
});
