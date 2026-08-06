// @vitest-environment node
// The /api/chat producer branch: 202 + position/depth snapshot, and the
// QueueFullError -> 429 + Retry-After mapping (#914 producer, #915 backpressure).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: vi.fn(),
    createDataStreamResponse: vi.fn(() => new Response("", { status: 200 })),
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
  requireServiceKey: vi.fn().mockReturnValue(null),
}));

vi.mock("~/lib/auth/course-access.server", () => ({
  resolveCourseAccessWithCourse: vi.fn().mockResolvedValue({
    course: { id: "course-1", isPublished: true, code: "COSC101" },
    access: { level: "student" },
  }),
  resolveCourseAccess: vi.fn().mockResolvedValue({ level: "student" }),
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

vi.mock("~/lib/user-provider-settings.server", () => ({
  getUserProviderSettings: vi.fn().mockResolvedValue({}),
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

// Only the enqueue call itself is stubbed. `isEnqueueRequested` stays real so the
// QUEUE_ENQUEUE_ENABLED + `enqueue: true` double gate is exercised, and
// QueueFullError stays real because the route branches on `instanceof`.
vi.mock("~/lib/queue/chat-producer.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/queue/chat-producer.server")>();
  return { ...actual, enqueueQuestionGeneration: vi.fn() };
});

import { streamText } from "ai";
import { action } from "~/routes/api/chat";
import { auth } from "~/lib/auth/server";
import { resetRateLimitsForTests } from "~/lib/auth/rate-limit.server";
import prisma from "~/lib/prisma.server";
import { enqueueQuestionGeneration } from "~/lib/queue/chat-producer.server";
import { QueueFullError, QUEUE_FULL_RETRY_AFTER_SECONDS } from "~/lib/queue/queue-stats.server";

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

function enqueueBody(overrides: Record<string, unknown> = {}) {
  return {
    messages: [{ id: "msg-1", role: "user", content: "Write 5 questions on recursion." }],
    model: "vllm:test-model",
    apiKeys: {},
    streaming: false,
    chatId: CHAT_ID,
    courseId: COURSE_ID,
    enqueue: true,
    source: "question-maker",
    routingContext: { jobType: "background" },
    count: 5,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  resetRateLimitsForTests();
  vi.stubEnv("VLLM_BASE_URL", "http://localhost:8001");
  vi.stubEnv("QUEUE_ENQUEUE_ENABLED", "true");

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
});

describe("/api/chat enqueue branch (#914/#915)", () => {
  it("returns 202 with the job id and the live position/depth snapshot", async () => {
    vi.mocked(enqueueQuestionGeneration).mockResolvedValue({
      jobId: "aijob_1",
      queuePosition: 3,
      queueDepth: 7,
    });

    const res = await action(makeRequest(enqueueBody()));

    expect(res.status).toBe(202);
    await expect(res.json()).resolves.toEqual({
      jobId: "aijob_1",
      queuePosition: 3,
      queueDepth: 7,
    });
    // The producer branch replaces the stream entirely — no model call.
    expect(streamText).not.toHaveBeenCalled();
  });

  it("passes the null snapshot through when the stats read degraded", async () => {
    // enqueue() nulls both halves rather than 5xx-ing a job that is already
    // durably queued; the 202 must still carry the job id.
    vi.mocked(enqueueQuestionGeneration).mockResolvedValue({
      jobId: "aijob_2",
      queuePosition: null,
      queueDepth: null,
    });

    const res = await action(makeRequest(enqueueBody()));

    expect(res.status).toBe(202);
    await expect(res.json()).resolves.toEqual({
      jobId: "aijob_2",
      queuePosition: null,
      queueDepth: null,
    });
  });

  it("maps QueueFullError to 429 with a Retry-After header", async () => {
    vi.mocked(enqueueQuestionGeneration).mockRejectedValue(
      new QueueFullError("ai-jobs-chat", 50, 50),
    );

    const res = await action(makeRequest(enqueueBody()));

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe(String(QUEUE_FULL_RETRY_AFTER_SECONDS));
    const body = await res.json();
    expect(body).toEqual(
      expect.objectContaining({
        error: "AI job queue is full",
        retryAfterSeconds: QUEUE_FULL_RETRY_AFTER_SECONDS,
      }),
    );
    // A saturated queue is a rate signal, not a failure — nothing was streamed.
    expect(streamText).not.toHaveBeenCalled();
  });

  it("maps a queue/Redis outage to 502, never to 429 or a client error", async () => {
    vi.mocked(enqueueQuestionGeneration).mockRejectedValue(new Error("redis down"));

    const res = await action(makeRequest(enqueueBody()));

    expect(res.status).toBe(502);
    expect(res.headers.get("Retry-After")).toBeNull();
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({ error: "Failed to enqueue AI job" }),
    );
  });

  it("does not enter the producer branch when QUEUE_ENQUEUE_ENABLED is unset", async () => {
    vi.stubEnv("QUEUE_ENQUEUE_ENABLED", "");
    vi.mocked(streamText).mockResolvedValue({
      consumeStream: vi.fn().mockResolvedValue(undefined),
      text: Promise.resolve("ok"),
      usage: Promise.resolve({ promptTokens: 1, completionTokens: 1 }),
      finishReason: Promise.resolve("stop"),
      sources: Promise.resolve([]),
      reasoning: Promise.resolve(undefined),
      response: Promise.resolve({ id: "resp-1", messages: [] }),
    } as never);

    const res = await action(makeRequest(enqueueBody()));

    expect(res.status).not.toBe(202);
    expect(enqueueQuestionGeneration).not.toHaveBeenCalled();
  });
});
