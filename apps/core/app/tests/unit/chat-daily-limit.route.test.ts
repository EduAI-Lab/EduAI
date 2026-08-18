// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const checkRateLimitMock = vi.hoisted(() => vi.fn());

vi.mock("~/lib/auth/rate-limit.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/auth/rate-limit.server")>();
  return { ...actual, checkRateLimit: checkRateLimitMock };
});

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

vi.mock("~/lib/agent-tools", () => ({
  buildAdminSystemPrompt: vi.fn().mockReturnValue(""),
  chatbotTypeFromMode: vi.fn().mockReturnValue("learning"),
  createChatTools: vi.fn().mockReturnValue({}),
  parseChatMode: vi.fn().mockReturnValue("learning"),
}));

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/guards.server", () => ({
  enforceAdminIfApiKey: vi.fn().mockResolvedValue({ response: null, session: null }),
  requireServiceKey: vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ error: "MISSING_SERVICE_KEY" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }),
  ),
}));

vi.mock("~/lib/auth/course-access.server", () => ({
  resolveCourseAccessWithCourse: vi.fn().mockResolvedValue({
    course: { id: "course-1", isPublished: true, code: "COSC101" },
    access: { level: "student" },
  }),
}));

vi.mock("~/lib/ai/providers.server", () => ({
  getChatModelCapabilities: vi.fn().mockResolvedValue({
    supportsTools: false,
    maxTokens: null,
    name: null,
  }),
  modelSupportsTools: vi.fn().mockResolvedValue(false),
}));

vi.mock("~/lib/assistive-events.server", () => ({
  recordResponseComplianceEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/policy.server", () => ({
  getPolicy: vi.fn().mockResolvedValue(false),
  invalidatePolicyCache: vi.fn(),
}));

vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn((p: Promise<unknown>) => p),
  logSecurityEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    chat: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    chatMessage: { findMany: vi.fn(), createMany: vi.fn() },
    course: { findFirst: vi.fn(), findUnique: vi.fn() },
    aIModel: { findFirst: vi.fn() },
    systemConfig: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock("~/lib/user-provider-settings.server", () => ({
  getUserProviderSettings: vi.fn().mockResolvedValue({}),
}));

import { streamText } from "ai";
import { action } from "~/routes/api/chat";
import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";
import { CHAT_DAILY_WINDOW_MS } from "~/lib/chat-daily-limits";

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
  } as never;
}

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    messages: [{ id: "msg-1", role: "user", content: "Explain recursion." }],
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
  checkRateLimitMock.mockResolvedValue({ limited: false, retryAfter: 0 });
  process.env.VLLM_BASE_URL = "http://localhost:8001";
  process.env.CHAT_RATE_LIMIT = "1000000";
  vi.mocked(streamText).mockResolvedValue({
    consumeStream: vi.fn().mockResolvedValue(undefined),
    text: Promise.resolve("Partial answer."),
    usage: Promise.resolve({ promptTokens: 5, completionTokens: 10 }),
    finishReason: Promise.resolve("stop"),
    sources: Promise.resolve([]),
    reasoning: Promise.resolve(undefined),
    response: Promise.resolve({
      id: "resp-1",
      messages: [{ id: "msg-1", role: "assistant", content: "Partial answer." }],
    }),
  } as never);
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
  vi.mocked(prisma.chatMessage.findMany).mockResolvedValue([]);
  vi.mocked(prisma.chatMessage.createMany).mockResolvedValue({ count: 1 });
  vi.mocked(prisma.course.findUnique).mockResolvedValue({ code: "COSC101" } as never);
  vi.mocked(prisma.aIModel.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.systemConfig.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.systemConfig.findMany).mockResolvedValue([]);
});

afterEach(() => {
  delete process.env.CHAT_RATE_LIMIT;
});

describe("POST /api/chat — local chatbot daily caps (#1547)", () => {
  it("applies the default 50/day student cap on local models", async () => {
    await action(makeRequest(baseBody()));
    expect(checkRateLimitMock).toHaveBeenCalledWith(
      "chat-daily:user-1",
      50,
      CHAT_DAILY_WINDOW_MS,
    );
  });

  it("applies the default 200/day instructor cap on local models", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "instr-1", role: "INSTRUCTOR" },
    } as never);
    vi.mocked(prisma.chat.findFirst).mockResolvedValue({
      id: CHAT_ID,
      userId: "instr-1",
      courseId: COURSE_ID,
      adhdAssist: false,
      systemPrompt: null,
    } as never);

    await action(makeRequest(baseBody()));
    expect(checkRateLimitMock).toHaveBeenCalledWith(
      "chat-daily:instr-1",
      200,
      CHAT_DAILY_WINDOW_MS,
    );
  });

  it("does not apply the daily cap to a user-supplied cloud provider", async () => {
    await action(makeRequest(baseBody({ model: "openai:gpt-4o" })));
    expect(checkRateLimitMock).not.toHaveBeenCalledWith(
      "chat-daily:user-1",
      50,
      CHAT_DAILY_WINDOW_MS,
    );
  });

  it("returns 429 when the daily cap is exhausted", async () => {
    checkRateLimitMock.mockImplementation(async (key: string) => {
      if (String(key).startsWith("chat-daily:")) {
        return { limited: true, retryAfter: 3600 };
      }
      return { limited: false, retryAfter: 0 };
    });

    const res = await action(makeRequest(baseBody()));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "RATE_LIMITED", retryAfter: 3600 });
  });
});
