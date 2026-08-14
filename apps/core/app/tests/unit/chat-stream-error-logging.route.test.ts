// @vitest-environment node
// Learning-chat stream errors must be logged server-side too, not just admin chat (#989).
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

// Chat resolves per-user provider keys before streamText; without this mock the
// action throws on prisma.userProviderSettings and never wires onError (#989).
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
import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";

const CHAT_ID = "cjld2cjxh0000qzrmn831i7rn";
const COURSE_ID = "course-1";
let lateStreamErrorMessage: ((error: unknown) => string) | undefined;

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

function lastOnError(): ((args: { error: unknown }) => void) | undefined {
  const call = vi.mocked(streamText).mock.calls.at(-1)?.[0] as
    | { onError?: (args: { error: unknown }) => void }
    | undefined;
  return call?.onError;
}

beforeEach(() => {
  vi.clearAllMocks();
  lateStreamErrorMessage = undefined;
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

  vi.mocked(prisma.chatMessage.findMany).mockResolvedValue([]);
  vi.mocked(prisma.chatMessage.createMany).mockResolvedValue({ count: 1 });
  vi.mocked(prisma.course.findUnique).mockResolvedValue({ code: "COSC101" } as never);
  vi.mocked(prisma.aIModel.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.systemConfig.findUnique).mockResolvedValue(null);

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
    toDataStreamResponse: vi.fn(
      ({ getErrorMessage }: { getErrorMessage?: (error: unknown) => string }) => {
        lateStreamErrorMessage = getErrorMessage;
        return new Response("stream", { status: 200 });
      },
    ),
  } as never);
});

describe("Learning-chat stream error logging (#989)", () => {
  it("wires onError for the default (non-admin) chat mode", async () => {
    await action(makeRequest(baseBody()));

    expect(lastOnError()).toBeInstanceOf(Function);
  });

  it("logs to console.error when the wired onError fires", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await action(makeRequest(baseBody()));

    const onError = lastOnError();
    expect(onError).toBeDefined();
    onError?.({ error: new Error("provider blew up mid-stream") });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[chat-api] stream error",
      expect.objectContaining({ error: "provider blew up mid-stream" }),
    );

    consoleErrorSpy.mockRestore();
  });

  it("serializes the stable provider body through the late stream error channel", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await action(makeRequest(baseBody({ streaming: true })));
    expect(res.status).toBe(200);

    const message = lateStreamErrorMessage?.(
      new APICallError({
        message: "upstream error containing sk-do-not-leak",
        url: "https://provider.test/v1/chat",
        requestBodyValues: { apiKey: "sk-do-not-leak" },
        statusCode: 503,
        responseHeaders: { "retry-after": "20" },
        responseBody: "private body",
        isRetryable: true,
      }),
    );

    expect(message).toBe(
      JSON.stringify({
        error: "Provider is temporarily unavailable",
        code: "PROVIDER_UNAVAILABLE",
        retryable: true,
        provider: "vllm",
      }),
    );
    expect(message).not.toContain("sk-do-not-leak");
    consoleErrorSpy.mockRestore();
  });
});
