// @vitest-environment node
// Pre-MVP regression coverage: legacy queue inputs must stay on authenticated
// direct chat even when old deployment configuration still sets the flag.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RouteRequestBody } from "../helpers/route-fixtures";

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
    topics: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

// Keep the dormant producer observable: the route must never import/call it.
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

function mockDirectResponse(content = "direct response") {
  vi.mocked(streamText).mockResolvedValue({
    consumeStream: vi.fn().mockResolvedValue(undefined),
    text: Promise.resolve(content),
    usage: Promise.resolve({ promptTokens: 1, completionTokens: 1 }),
    finishReason: Promise.resolve("stop"),
    sources: Promise.resolve([]),
    reasoning: Promise.resolve(undefined),
    response: Promise.resolve({ id: "resp-direct", messages: [] }),
  } as never);
}

describe("/api/chat pre-MVP queue disable", () => {
  it("keeps direct chat functional when the legacy queue flag is true", async () => {
    vi.mocked(enqueueQuestionGeneration).mockResolvedValue({
      jobId: "must-not-be-returned",
      queuePosition: 1,
      queueDepth: 1,
    });
    mockDirectResponse();

    const res = await action(makeRequest(enqueueBody()));

    expect(res.status).toBe(200);
    expect(enqueueQuestionGeneration).not.toHaveBeenCalled();
    expect(streamText).toHaveBeenCalled();
  });

  it("keeps direct chat functional when the legacy flag is absent", async () => {
    vi.stubEnv("QUEUE_ENQUEUE_ENABLED", "");
    mockDirectResponse("ok");

    const res = await action(makeRequest(enqueueBody()));

    expect(res.status).toBe(200);
    expect(enqueueQuestionGeneration).not.toHaveBeenCalled();
    expect(streamText).toHaveBeenCalled();
  });
});
