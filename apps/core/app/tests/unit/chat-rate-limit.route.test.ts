// @vitest-environment node
// Per-user rate limiting for /api/chat (#987): caps LLM completion requests
// so an authenticated user can't submit unbounded requests to the model.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
    systemConfig: { findUnique: vi.fn() },
  },
}));

vi.mock("~/lib/user-provider-settings.server", () => ({
  getUserProviderSettings: vi.fn().mockResolvedValue({}),
}));

import { streamText } from "ai";
import { action } from "~/routes/api/chat";
import { requireServiceKey } from "~/lib/auth/guards.server";
import { auth } from "~/lib/auth/server";
import { resetRateLimitsForTests } from "~/lib/auth/rate-limit.server";
import { logSecurityEvent } from "~/lib/logging.server";
import prisma from "~/lib/prisma.server";

const CHAT_ID = "cjld2cjxh0000qzrmn831i7rn";
const COURSE_ID = "course-1";
const originalChatRateLimit = process.env.CHAT_RATE_LIMIT;
const originalChatRateLimitWindow = process.env.CHAT_RATE_LIMIT_WINDOW_MS;
const originalChatRateWindow = process.env.CHAT_RATE_WINDOW_MS;

function makeRequest(body: object) {
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

function mockStream() {
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
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimitsForTests();
  checkRateLimitMock.mockResolvedValue({ limited: false, retryAfter: 0 });
  process.env.VLLM_BASE_URL = "http://localhost:8001";
  process.env.CHAT_RATE_LIMIT = "2";
  process.env.CHAT_RATE_LIMIT_WINDOW_MS = "60000";
  process.env.CHAT_RATE_WINDOW_MS = "60000";
  vi.mocked(requireServiceKey).mockResolvedValue(
    new Response(JSON.stringify({ error: "MISSING_SERVICE_KEY" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }),
  );

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
  mockStream();
});

afterEach(() => {
  if (originalChatRateLimit === undefined) delete process.env.CHAT_RATE_LIMIT;
  else process.env.CHAT_RATE_LIMIT = originalChatRateLimit;
  if (originalChatRateLimitWindow === undefined) delete process.env.CHAT_RATE_LIMIT_WINDOW_MS;
  else process.env.CHAT_RATE_LIMIT_WINDOW_MS = originalChatRateLimitWindow;
  if (originalChatRateWindow === undefined) delete process.env.CHAT_RATE_WINDOW_MS;
  else process.env.CHAT_RATE_WINDOW_MS = originalChatRateWindow;
});

describe("POST /api/chat — per-user rate limit (#987)", () => {
  it("allows requests under the configured limit", async () => {
    const res1 = await action(makeRequest(baseBody()));
    const res2 = await action(makeRequest(baseBody()));
    expect(res1.status).not.toBe(429);
    expect(res2.status).not.toBe(429);
    expect(checkRateLimitMock).toHaveBeenCalledWith("chat:user-1", 2, 60_000);
  });

  it("returns the stable 429 contract before calling the provider", async () => {
    checkRateLimitMock.mockResolvedValue({ limited: true, retryAfter: 17 });

    const res = await action(makeRequest(baseBody()));

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "RATE_LIMITED", retryAfter: 17 });
    expect(res.headers.get("Retry-After")).toBe("17");
    expect(streamText).not.toHaveBeenCalled();
  });

  it("logs a RATE_LIMIT_EXCEEDED security event when throttled", async () => {
    checkRateLimitMock.mockResolvedValue({ limited: true, retryAfter: 17 });
    await action(makeRequest(baseBody()));

    expect(logSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actionCode: "RATE_LIMIT_EXCEEDED",
        outcome: "DENIED",
        entityType: "Chat",
      }),
    );
  });

  it("tracks each user independently", async () => {
    await action(makeRequest(baseBody()));

    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "user-2", role: "STUDENT" },
    } as never);

    const res = await action(makeRequest(baseBody()));
    expect(res.status).not.toBe(429);
    expect(checkRateLimitMock).toHaveBeenNthCalledWith(1, "chat:user-1", 2, 60_000);
    expect(checkRateLimitMock).toHaveBeenNthCalledWith(2, "chat:user-2", 2, 60_000);
  });

  it("rate-limits direct service-key callers with a stable non-secret identity", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    vi.mocked(requireServiceKey).mockResolvedValue(null);
    checkRateLimitMock.mockResolvedValue({ limited: true, retryAfter: 9 });

    const res = await action(
      makeRequest({ messages: [], model: "vllm:test-model" }),
    );

    expect(res.status).toBe(429);
    expect(checkRateLimitMock).toHaveBeenCalledWith("chat:service", 2, 60_000);
  });

  it("returns authentication failures before checking the limiter", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);

    const res = await action(makeRequest(baseBody()));

    expect(res.status).toBe(401);
    expect(checkRateLimitMock).not.toHaveBeenCalled();
  });

  it("uses the documented defaults when rate-limit env values are blank", async () => {
    process.env.CHAT_RATE_LIMIT = "";
    process.env.CHAT_RATE_LIMIT_WINDOW_MS = "";
    process.env.CHAT_RATE_WINDOW_MS = "";

    await action(makeRequest(baseBody()));

    expect(checkRateLimitMock).toHaveBeenCalledWith("chat:user-1", 100, 60_000);
  });

  it("keeps CHAT_RATE_WINDOW_MS as a fallback alias", async () => {
    process.env.CHAT_RATE_LIMIT_WINDOW_MS = "";
    process.env.CHAT_RATE_WINDOW_MS = "45000";

    await action(makeRequest(baseBody()));

    expect(checkRateLimitMock).toHaveBeenCalledWith("chat:user-1", 2, 45_000);
  });
});
