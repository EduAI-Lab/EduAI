// @vitest-environment node
// #1113: /api/chat threshold behavior using the integration Redis service.
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: vi.fn(),
    createDataStreamResponse: vi.fn(({ execute }) => {
      const chunks: string[] = [];
      execute({ write: (part: string) => chunks.push(part) });
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

vi.mock("~/lib/auth/server", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("~/lib/auth/guards.server", () => ({
  enforceAdminIfApiKey: vi.fn().mockResolvedValue({ response: null, session: null }),
  requireServiceKey: vi.fn().mockResolvedValue(null),
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
  fireAndForget: vi.fn((promise: Promise<unknown>) => promise),
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
import { auth } from "~/lib/auth/server";
import { resetRateLimitsForTests } from "~/lib/auth/rate-limit.server";
import { rateLimitRedis } from "~/lib/queue/connection.server";
import prisma from "~/lib/prisma.server";
import { action } from "~/routes/api/chat";

const keysToClean = new Set<string>();
const chatId = "cjld2cjxh0000qzrmn831i7rn";

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    request: new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ id: randomUUID(), role: "user", content: "Explain recursion." }],
        model: "vllm:test-model",
        apiKeys: {},
        streaming: false,
        chatId,
        courseId: "course-1",
        ...overrides,
      }),
    }),
    params: {},
    context: {} as never,
  } as never;
}

beforeEach(async () => {
  vi.clearAllMocks();
  resetRateLimitsForTests();
  vi.stubEnv("VLLM_BASE_URL", "http://localhost:8001");
  vi.stubEnv("CHAT_RATE_LIMIT", "2");
  vi.stubEnv("CHAT_RATE_LIMIT_WINDOW_MS", "60000");

  for (const key of keysToClean) await rateLimitRedis.del(key);
  keysToClean.clear();

  vi.mocked(prisma.chat.findFirst).mockResolvedValue({
    id: chatId,
    userId: "session-user",
    courseId: "course-1",
    adhdAssist: false,
    systemPrompt: null,
  } as never);
  vi.mocked(prisma.chatMessage.findMany).mockResolvedValue([]);
  vi.mocked(prisma.chatMessage.createMany).mockResolvedValue({ count: 1 });
  vi.mocked(prisma.course.findUnique).mockResolvedValue({ code: "COSC101" } as never);
  vi.mocked(prisma.aIModel.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.systemConfig.findUnique).mockResolvedValue(null);
  vi.mocked(streamText).mockResolvedValue({
    consumeStream: vi.fn().mockResolvedValue(undefined),
    text: Promise.resolve("Stubbed response."),
    usage: Promise.resolve({ promptTokens: 2, completionTokens: 2 }),
    finishReason: Promise.resolve("stop"),
    sources: Promise.resolve([]),
    reasoning: Promise.resolve(undefined),
    response: Promise.resolve({
      id: "response-1",
      messages: [{ id: "assistant-1", role: "assistant", content: "Stubbed response." }],
    }),
  } as never);
});

afterAll(async () => {
  for (const key of keysToClean) await rateLimitRedis.del(key);
  vi.unstubAllEnvs();
});

describe("POST /api/chat distributed rate limit (#1113)", () => {
  it("limits a service-key caller and stops before a third provider call", async () => {
    const key = "chat:service";
    keysToClean.add(key);
    await rateLimitRedis.del(key);
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);

    const first = await action(makeRequest({ chatId: null, courseId: null }));
    const second = await action(makeRequest({ chatId: null, courseId: null }));
    const denied = await action(makeRequest({ chatId: null, courseId: null }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(denied.status).toBe(429);
    const body = await denied.json();
    expect(body).toEqual({ error: "RATE_LIMITED", retryAfter: expect.any(Number) });
    expect(Number.isInteger(body.retryAfter)).toBe(true);
    expect(body.retryAfter).toBeGreaterThan(0);
    expect(denied.headers.get("Retry-After")).toBe(String(body.retryAfter));
    expect(streamText).toHaveBeenCalledTimes(2);
  });

  it("allows N session requests and blocks N+1 before provider execution", async () => {
    const userId = `chat-integration-${randomUUID()}`;
    const key = `chat:${userId}`;
    keysToClean.add(key);
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: userId, role: "STUDENT" },
    } as never);
    vi.mocked(prisma.chat.findFirst).mockResolvedValue({
      id: chatId,
      userId,
      courseId: "course-1",
      adhdAssist: false,
      systemPrompt: null,
    } as never);

    const first = await action(makeRequest());
    const second = await action(makeRequest());
    const denied = await action(makeRequest());

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(denied.status).toBe(429);
    const body = await denied.json();
    expect(body).toEqual({ error: "RATE_LIMITED", retryAfter: expect.any(Number) });
    expect(Number.isInteger(body.retryAfter)).toBe(true);
    expect(body.retryAfter).toBeGreaterThan(0);
    expect(denied.headers.get("Retry-After")).toBe(String(body.retryAfter));
    expect(streamText).toHaveBeenCalledTimes(2);
  });
});
