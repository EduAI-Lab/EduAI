// @vitest-environment node
// #1441 review: admission timeout must skip the rethrow after Bedrock overflow
// activates, so the request reaches streamText on the overflow model.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  parseChatMode: vi.fn().mockReturnValue("admin"),
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
    access: { level: "admin" },
  }),
}));

vi.mock("~/lib/ai/providers.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/ai/providers.server")>();
  return {
    ...actual,
    resolveActiveChatModel: vi.fn().mockResolvedValue({
      supportsTools: true,
      maxTokens: 16_384,
      name: "Qwen test",
    }),
    getChatModelCapabilities: vi.fn().mockResolvedValue({
      supportsTools: true,
      maxTokens: 16_384,
      name: "Qwen test",
    }),
    modelSupportsTools: vi.fn().mockResolvedValue(true),
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
  getPolicy: vi.fn().mockResolvedValue(false),
  invalidatePolicyCache: vi.fn(),
}));

vi.mock("~/lib/user-provider-settings.server", () => ({
  getUserProviderSettings: vi.fn().mockResolvedValue({}),
}));

vi.mock("~/lib/ai/routing/fleet/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/ai/routing/fleet/registry")>();
  return { ...actual, fleetRoutingEnabled: vi.fn(() => false) };
});

vi.mock("~/lib/prisma.server", () => ({
  default: {
    chat: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    chatMessage: { findMany: vi.fn(), createMany: vi.fn() },
    course: { findFirst: vi.fn(), findUnique: vi.fn() },
    aIModel: { findFirst: vi.fn() },
    systemConfig: { findUnique: vi.fn() },
  },
}));

vi.mock("~/lib/ai/admission.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/ai/admission.server")>();
  return {
    ...actual,
    acquireAiAdmission: vi.fn(),
  };
});

import { streamText } from "ai";
import { action } from "~/routes/api/chat";
import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";
import {
  AdmissionTimeoutError,
  acquireAiAdmission,
} from "~/lib/ai/admission.server";
import { resetRateLimitsForTests } from "~/lib/auth/rate-limit.server";

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

function makeFullStream(
  parts: unknown[],
  onChunk?: (chunk: unknown) => void,
): ReadableStream<unknown> {
  return new ReadableStream({
    async pull(controller) {
      const part = parts.shift();
      if (part === undefined) {
        controller.close();
        return;
      }
      onChunk?.({ chunk: part });
      controller.enqueue(part);
    },
  });
}

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    messages: [{ id: "msg-1", role: "user", content: "Explain recursion." }],
    model: "vllm:test-model",
    apiKeys: {},
    streaming: false,
    chatId: CHAT_ID,
    courseId: COURSE_ID,
    chatMode: "admin",
    ...overrides,
  };
}

const ENV_KEYS = ["AWS_BEARER_TOKEN_BEDROCK", "VLLM_BASE_URL"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimitsForTests();
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env.VLLM_BASE_URL = "http://localhost:8001";
  delete process.env.AWS_BEARER_TOKEN_BEDROCK;

  vi.mocked(acquireAiAdmission).mockRejectedValue(new AdmissionTimeoutError());
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "user-1", role: "ADMIN" },
  } as never);

  vi.mocked(prisma.chat.findFirst).mockResolvedValue({
    id: CHAT_ID,
    userId: "user-1",
    courseId: COURSE_ID,
    adhdAssist: false,
    systemPrompt: null,
  } as never);
  vi.mocked(prisma.chat.update).mockResolvedValue({
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

  vi.mocked(streamText).mockImplementation((args) => {
    args.onStepFinish?.({ toolCalls: [], toolResults: [] } as never);
    return {
      get fullStream() {
        return makeFullStream(
          [{ type: "text-delta", text: "Overflowed to Bedrock." }],
          args.onChunk as never,
        );
      },
      consumeStream: vi.fn().mockResolvedValue(undefined),
      text: Promise.resolve("Overflowed to Bedrock."),
      usage: Promise.resolve({ promptTokens: 5, completionTokens: 10 }),
      finishReason: Promise.resolve("stop"),
      sources: Promise.resolve([]),
      reasoning: Promise.resolve(undefined),
      response: Promise.resolve({
        id: "resp-1",
        messages: [{ id: "msg-1", role: "assistant", content: "Overflowed to Bedrock." }],
      }),
    } as never;
  });
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("Bedrock overflow after admission timeout (#1441)", () => {
  it("returns 503 when overflow cannot activate", async () => {
    const res = await action(makeRequest(baseBody()));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: "Server busy — too many concurrent AI requests. Try again shortly.",
      code: "AI_ADMISSION_TIMEOUT",
    });
    expect(streamText).not.toHaveBeenCalled();
  });

  it("reaches streamText on Bedrock instead of rethrowing AdmissionTimeoutError", async () => {
    process.env.AWS_BEARER_TOKEN_BEDROCK = "test-token";

    const res = await action(makeRequest(baseBody()));
    expect(res.status).toBe(200);
    expect(streamText).toHaveBeenCalledTimes(1);
  });
});
