// @vitest-environment node
// Client abort / stop-button support for /api/chat (#267).
import type { JsonObject, JsonValue } from "~/lib/json-value";
import { describe, it, expect, vi, beforeEach } from "vitest";
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
  pickCoreAdminChatTools: vi.fn((tools) => tools),
  ADMIN_CORE_TOOL_NAMES: [],
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

vi.mock("~/lib/ai/adhd-oversight", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/ai/adhd-oversight")>();
  return { ...actual, auditAndMaybeRewrite: vi.fn() };
});

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

import { APICallError, streamText } from "ai";
import { action } from "~/routes/api/chat";
import { action as cancelAction } from "~/routes/api/chat.cancel";
import { auth } from "~/lib/auth/server";
import { getAiAdmissionStats, resetAiAdmission } from "~/lib/ai/admission.server";
import { resetRateLimitsForTests } from "~/lib/auth/rate-limit.server";
import prisma from "~/lib/prisma.server";

const CHAT_ID = "cjld2cjxh0000qzrmn831i7rn";
const COURSE_ID = "course-1";

function makeRequest(body: RouteRequestBody, signal?: AbortSignal, requestId?: string) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (requestId) headers.set("X-EduAI-Request-Id", requestId);

  return {
    request: new Request("http://localhost/api/chat", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    }),
    params: {},
    context: {} as never,
  } as any;
}

function makeCancelRequest(requestId: string) {
  return {
    request: new Request("http://localhost/api/chat/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId }),
    }),
    params: {},
    context: {} as never,
  } as never;
}

function baseBody(overrides: JsonObject = {}) {
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

function streamResult() {
  return {
    toDataStreamResponse: vi.fn(() => new Response("streamed answer")),
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
  } as never;
}

function heldStreamingResult() {
  return {
    ...(streamResult() as object),
    toDataStreamResponse: vi.fn(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("held answer"));
            },
          }),
        ),
    ),
  } as never;
}

function mockStream() {
  vi.mocked(streamText).mockResolvedValue(streamResult());
}

function lastAbortSignal(): AbortSignal | undefined {
  const call = vi.mocked(streamText).mock.calls.at(-1)?.[0] as
    | { abortSignal?: AbortSignal }
    | undefined;
  return call?.abortSignal;
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
  vi.mocked(prisma.course.findUnique).mockResolvedValue({ code: "COSC101" } as never);
  vi.mocked(prisma.aIModel.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.systemConfig.findUnique).mockResolvedValue(null);
});

describe("Chat API client abort (#267)", () => {
  it("requests streaming usage from OpenAI-compatible local providers", async () => {
    mockStream();

    await action(makeRequest(baseBody()));

    expect(vi.mocked(streamText).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        providerOptions: {
          vllm: { streamOptions: { includeUsage: true } },
        },
      }),
    );
  });

  it("forwards a request abort to the active provider stream", async () => {
    const controller = new AbortController();
    const args = makeRequest(baseBody(), controller.signal);
    let resolveStream: ((value: ReturnType<typeof streamResult>) => void) | undefined;
    vi.mocked(streamText).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStream = resolve;
        }) as never,
    );

    const actionPromise = action(args);
    await vi.waitFor(() => expect(streamText).toHaveBeenCalled());
    expect(lastAbortSignal()).not.toBe(args.request.signal);

    controller.abort();
    expect(lastAbortSignal()?.aborted).toBe(true);
    resolveStream?.(streamResult());

    await actionPromise;
  });

  it("cancels a registered stream through the chat cancel route", async () => {
    const requestId = "9f1ac5c9-2abf-4b1e-b2f9-dbc1697e0aac";
    let resolveStream: ((value: ReturnType<typeof streamResult>) => void) | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    vi.mocked(streamText).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStream = resolve;
          markStarted?.();
        }) as never,
    );

    const chatAction = action(makeRequest(baseBody({ streaming: true }), undefined, requestId));
    await started;
    expect(lastAbortSignal()?.aborted).toBe(false);

    const cancelResponse = await cancelAction(makeCancelRequest(requestId));
    expect(cancelResponse.status).toBe(204);
    expect(lastAbortSignal()?.aborted).toBe(true);

    resolveStream?.(streamResult());
    await chatAction;
  });

  it("honors cancellation requested before the stream is registered", async () => {
    const previousMaxInflight = process.env.AI_MAX_INFLIGHT;
    process.env.AI_MAX_INFLIGHT = "1";
    resetAiAdmission();

    let resolveCourse: ((value: unknown) => void) | undefined;
    vi.mocked(prisma.course.findUnique).mockImplementationOnce(
      () => new Promise((resolve) => (resolveCourse = resolve)) as never,
    );

    const requestId = "4d0c8f45-7a5f-4f12-9a73-2f719ea4cc93";
    try {
      const chatAction = action(makeRequest(baseBody({ streaming: true }), undefined, requestId));
      await vi.waitFor(() => expect(prisma.course.findUnique).toHaveBeenCalled());

      const cancelResponse = await cancelAction(makeCancelRequest(requestId));
      expect(cancelResponse.status).toBe(204);

      resolveCourse?.({ code: "COSC101" });
      await expect(chatAction).resolves.toMatchObject({ status: 499 });
      expect(streamText).not.toHaveBeenCalled();
    } finally {
      resetAiAdmission();
      if (previousMaxInflight === undefined) delete process.env.AI_MAX_INFLIGHT;
      else process.env.AI_MAX_INFLIGHT = previousMaxInflight;
    }
  });

  it("cancels a request while it is queued for an admission slot", async () => {
    const previousMaxInflight = process.env.AI_MAX_INFLIGHT;
    process.env.AI_MAX_INFLIGHT = "1";
    resetAiAdmission();
    vi.mocked(streamText).mockImplementation(() => heldStreamingResult());

    const holderId = "9f1ac5c9-2abf-4b1e-b2f9-dbc1697e0aac";
    const queuedId = "4d0c8f45-7a5f-4f12-9a73-2f719ea4cc93";
    try {
      await action(makeRequest(baseBody({ streaming: true }), undefined, holderId));
      await vi.waitFor(() => expect(getAiAdmissionStats().inflight).toBe(1));

      const queuedAction = action(makeRequest(baseBody({ streaming: true }), undefined, queuedId));
      await vi.waitFor(() => expect(getAiAdmissionStats().queued).toBe(1));

      const cancelResponse = await cancelAction(makeCancelRequest(queuedId));
      expect(cancelResponse.status).toBe(204);
      await expect(queuedAction).resolves.toMatchObject({ status: 499 });
      expect(getAiAdmissionStats().queued).toBe(0);

      const holderCancelResponse = await cancelAction(makeCancelRequest(holderId));
      expect(holderCancelResponse.status).toBe(204);
      await vi.waitFor(() => expect(getAiAdmissionStats().inflight).toBe(0));
    } finally {
      resetAiAdmission();
      if (previousMaxInflight === undefined) delete process.env.AI_MAX_INFLIGHT;
      else process.env.AI_MAX_INFLIGHT = previousMaxInflight;
    }
  });

  it("returns 499 when streamText throws AbortError", async () => {
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    vi.mocked(streamText).mockRejectedValue(abortError);

    const res = await action(makeRequest(baseBody()));

    expect(res.status).toBe(499);
  });

  it("normalizes non-admin stream startup failures", async () => {
    vi.mocked(streamText).mockImplementation(() => {
      throw providerApiError(503, "15");
    });

    const res = await action(makeRequest(baseBody()));

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("15");
    expect(await res.json()).toEqual({
      error: "Provider is temporarily unavailable",
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
      provider: "vllm",
    });
  });

  it("normalizes non-streaming provider result failures", async () => {
    const providerError = providerApiError(503, "7");
    vi.mocked(streamText).mockReturnValue({
      consumeStream: vi.fn().mockRejectedValue(providerError),
      text: Promise.resolve(""),
      usage: Promise.resolve(undefined),
      finishReason: Promise.resolve("error"),
      sources: Promise.resolve([]),
      reasoning: Promise.resolve(undefined),
      response: Promise.resolve(undefined),
    } as never);

    const res = await action(makeRequest(baseBody({ streaming: false })));

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("7");
    expect(await res.json()).toEqual({
      error: "Provider is temporarily unavailable",
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
      provider: "vllm",
    });
  });

  it("rejects a missing cloud-provider configuration before provider work", async () => {
    const res = await action(makeRequest(baseBody({ model: "openai:gpt-4o", apiKeys: {} })));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Provider configuration is invalid",
      code: "INVALID_PROVIDER_CONFIG",
      retryable: false,
      provider: "openai",
    });
    expect(streamText).not.toHaveBeenCalled();
  });
});

function providerApiError(statusCode: number, retryAfter: string) {
  return new APICallError({
    message: "provider failed with sk-do-not-leak",
    url: "https://provider.test/v1/chat",
    requestBodyValues: { apiKey: "sk-do-not-leak" },
    statusCode,
    responseHeaders: { "retry-after": retryAfter },
    responseBody: "private provider response",
    isRetryable: true,
  });
}
