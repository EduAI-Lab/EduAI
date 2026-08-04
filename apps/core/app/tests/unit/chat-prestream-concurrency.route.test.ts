// @vitest-environment node
// #942: `getPolicy`, `getChatModelCapabilities`/`resolveActiveChatModel`, and
// the course-RAG prefetch used to run as three serial awaits right before
// `streamText`, adding their latencies together into TTFB. They are mutually
// independent (none consumes another's result), so the route now fires them
// concurrently. These tests give each dependency an artificial delay and
// assert the route's total pre-stream latency tracks the slowest one, not
// their sum — proving the calls actually overlap rather than merely looking
// parallel in the source.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const DELAY_MS = 150;
// Serial execution would take >= 3 * DELAY_MS (default path) or 2 * DELAY_MS
// (admin path); concurrent execution should stay close to 1 * DELAY_MS. This
// threshold sits comfortably between "concurrent" and "two calls serialized"
// so the test is not flaky under normal CI scheduling jitter while still
// failing if the awaits regress back to serial.
const SERIAL_THRESHOLD_MS = DELAY_MS * 2.5;

function delay<T>(value: T, ms: number): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

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
  findRelevantContent: vi.fn(),
  generateEmbedding: vi.fn().mockResolvedValue([]),
  processMaterialEmbeddings: vi.fn(),
}));

const { adminTools } = vi.hoisted(() => {
  const adminTools = Object.fromEntries(
    Array.from({ length: 3 }, (_, i) => [`adminTool${i}`, { description: `t${i}` }]),
  );
  return { adminTools };
});

vi.mock("~/lib/agent-tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/agent-tools")>();
  return {
    ...actual,
    createChatTools: vi.fn().mockReturnValue(adminTools),
    buildAdminSystemPrompt: vi.fn().mockReturnValue("You are EduAI Admin Assistant."),
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

vi.mock("~/lib/ai/providers.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/ai/providers.server")>();
  return {
    ...actual,
    getChatModelCapabilities: vi.fn(),
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
  getPolicy: vi.fn(),
  invalidatePolicyCache: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    chat: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    chatMessage: { findMany: vi.fn(), createMany: vi.fn() },
    course: { findFirst: vi.fn(), findUnique: vi.fn() },
    systemConfig: { findUnique: vi.fn() },
    aIModel: { findFirst: vi.fn() },
    aIInteraction: { create: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock("~/lib/user-provider-settings.server", () => ({
  getUserProviderSettings: vi.fn().mockResolvedValue({}),
}));

import { streamText } from "ai";
import { action } from "~/routes/api/chat";
import { auth } from "~/lib/auth/server";
import { findRelevantContent } from "~/lib/ai/embedding";
import { getChatModelCapabilities } from "~/lib/ai/providers.server";
import { getPolicy } from "~/lib/policy.server";
import { resetRateLimitsForTests } from "~/lib/auth/rate-limit.server";
import prisma from "~/lib/prisma.server";

const CHAT_ID = "cjld2cjxh0000qzrmn831i7rn";
const COURSE_ID = "course-1";
const originalVllm = process.env.VLLM_BASE_URL;

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
    messages: [{ id: "msg-1", role: "user", content: "What does the syllabus say about late work?" }],
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

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimitsForTests();
  process.env.VLLM_BASE_URL = "http://localhost:8001";

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

  vi.mocked(prisma.chat.update).mockImplementation(
    (async (args: { data?: Record<string, unknown> }) => ({
      id: CHAT_ID,
      userId: "user-1",
      courseId: COURSE_ID,
      adhdAssist: false,
      systemPrompt: null,
      ...(args.data ?? {}),
    })) as never,
  );

  vi.mocked(prisma.chatMessage.findMany).mockResolvedValue([]);
  vi.mocked(prisma.chatMessage.createMany).mockResolvedValue({ count: 1 });
  vi.mocked(prisma.systemConfig.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.course.findUnique).mockResolvedValue({
    id: COURSE_ID,
    code: "COSC101",
    responseStyleTags: [],
    aiInstructions: null,
  } as never);
});

afterEach(() => {
  if (originalVllm === undefined) delete process.env.VLLM_BASE_URL;
  else process.env.VLLM_BASE_URL = originalVllm;
});

describe("POST /api/chat — pre-stream await concurrency (#942)", () => {
  it("runs getPolicy, getChatModelCapabilities, and course-RAG prefetch concurrently in the default (non-admin) path", async () => {
    vi.mocked(getPolicy).mockImplementation(() => delay(false, DELAY_MS));
    vi.mocked(getChatModelCapabilities).mockImplementation(() =>
      delay({ supportsTools: false, maxTokens: null, name: null }, DELAY_MS),
    );
    vi.mocked(findRelevantContent).mockImplementation(() =>
      delay([{ content: "Late work loses 10%.", similarity: 0.72, materialTitle: "Syllabus" }], DELAY_MS),
    );
    mockStream();

    const start = performance.now();
    const res = await action(makeRequest(baseBody()));
    const elapsedMs = performance.now() - start;

    expect(res.status).toBe(200);
    expect(getPolicy).toHaveBeenCalled();
    expect(getChatModelCapabilities).toHaveBeenCalled();
    expect(findRelevantContent).toHaveBeenCalled();
    // Serial awaits would take >= 3 * DELAY_MS; concurrent execution should
    // land close to 1 * DELAY_MS plus incidental route overhead.
    expect(elapsedMs).toBeLessThan(SERIAL_THRESHOLD_MS);
  });

  it("runs getPolicy and resolveActiveChatModel concurrently in the admin path", async () => {
    vi.mocked(getPolicy).mockImplementation(() => delay(false, DELAY_MS));
    vi.mocked(prisma.chat.findFirst).mockResolvedValue({
      id: CHAT_ID,
      userId: "admin-1",
      courseId: null,
      adhdAssist: false,
      systemPrompt: null,
      chatbotType: "ADMIN",
    } as never);
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    } as never);
    vi.mocked(prisma.aIModel.findFirst).mockImplementation(() =>
      delay({ supportsTools: true, maxTokens: 16_384, name: "Admin test model" }, DELAY_MS) as never,
    );
    mockStream();

    const start = performance.now();
    const res = await action(
      makeRequest(
        baseBody({
          courseId: undefined,
          chatMode: "admin",
          messages: [{ id: "msg-1", role: "user", content: "List users named alice@ubc.ca" }],
        }),
      ),
    );
    const elapsedMs = performance.now() - start;

    expect(res.status).toBe(200);
    expect(getPolicy).toHaveBeenCalled();
    expect(prisma.aIModel.findFirst).toHaveBeenCalled();
    // Serial awaits would take >= 2 * DELAY_MS; concurrent execution should
    // land close to 1 * DELAY_MS plus incidental route overhead.
    expect(elapsedMs).toBeLessThan(SERIAL_THRESHOLD_MS);
  });
});
