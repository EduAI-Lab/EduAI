// @vitest-environment node
// Route-level coverage for admin chat 16k context budgeting (#1008 review).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

const { ADMIN_TOOL_COUNT, adminTools } = vi.hoisted(() => {
  const ADMIN_TOOL_COUNT = 17;
  const adminTools = Object.fromEntries(
    Array.from({ length: ADMIN_TOOL_COUNT }, (_, i) => [`adminTool${i}`, { description: `t${i}` }]),
  );
  return { ADMIN_TOOL_COUNT, adminTools };
});

vi.mock("~/lib/agent-tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/agent-tools")>();
  return {
    ...actual,
    createChatTools: vi.fn().mockReturnValue(adminTools),
    buildAdminSystemPrompt: vi.fn().mockReturnValue(
      "You are EduAI Admin Assistant.\n".repeat(40) +
        "Write safety rules require confirmed:true.\n".repeat(20),
    ),
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
      name: "Qwen 16k test",
    }),
    getChatModelCapabilities: vi.fn().mockResolvedValue({
      supportsTools: true,
      maxTokens: 16_384,
      name: "Qwen 16k test",
    }),
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

vi.mock("~/lib/prisma.server", () => ({
  default: {
    chat: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    chatMessage: { findMany: vi.fn(), createMany: vi.fn() },
    course: { findFirst: vi.fn(), findUnique: vi.fn() },
    aIModel: { findFirst: vi.fn() },
    systemConfig: { findUnique: vi.fn() },
  },
}));

import { streamText } from "ai";
import { action } from "~/routes/api/chat";
import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";
import {
  estimateAdminToolStepReserve,
  estimateToolDefinitionTokens,
  promptFitsContextWindow,
} from "~/lib/ai/providers.server";

const CHAT_ID = "cjld2cjxh0000qzrmn831i7rn";
const CONTEXT_WINDOW = 16_384;

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
    messages: [{ id: "msg-1", role: "user", content: "List users named alice@ubc.ca" }],
    model: "vllm:qwen2.5-32b-instruct",
    streaming: false,
    chatId: CHAT_ID,
    chatMode: "admin",
    ...overrides,
  };
}

function lastStreamConfig(): {
  maxTokens?: number;
  maxSteps?: number;
  tools?: Record<string, unknown>;
} {
  return (vi.mocked(streamText).mock.calls.at(-1)?.[0] ?? {}) as {
    maxTokens?: number;
    maxSteps?: number;
    tools?: Record<string, unknown>;
  };
}

const originalVllm = process.env.VLLM_BASE_URL;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.VLLM_BASE_URL = "http://localhost:8001";

  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "admin-1", role: "ADMIN" },
  } as never);

  vi.mocked(prisma.chat.findFirst).mockResolvedValue({
    id: CHAT_ID,
    userId: "admin-1",
    courseId: null,
    adhdAssist: false,
    systemPrompt: null,
    chatbotType: "ADMIN",
  } as never);

  vi.mocked(prisma.chatMessage.findMany).mockResolvedValue([]);
  vi.mocked(prisma.chatMessage.createMany).mockResolvedValue({ count: 1 });

  vi.mocked(streamText).mockResolvedValue({
    consumeStream: vi.fn().mockResolvedValue(undefined),
    text: Promise.resolve("ok"),
    usage: Promise.resolve({ promptTokens: 5, completionTokens: 10 }),
    finishReason: Promise.resolve("stop"),
    sources: Promise.resolve([]),
    reasoning: Promise.resolve(undefined),
    response: Promise.resolve({
      id: "resp-1",
      messages: [{ id: "msg-1", role: "assistant", content: "ok" }],
    }),
  } as never);
});

afterEach(() => {
  if (originalVllm === undefined) delete process.env.VLLM_BASE_URL;
  else process.env.VLLM_BASE_URL = originalVllm;
});

describe("POST /api/chat — admin 16k context budget (#1008)", () => {
  it("caps admin maxTokens so tool schemas + step reserve fit a 16k window", async () => {
    const res = await action(makeRequest(baseBody()));
    expect(res.status).toBe(200);

    const config = lastStreamConfig();
    expect(Object.keys(config.tools ?? {})).toHaveLength(ADMIN_TOOL_COUNT);
    // 16k admin path caps desired completion at 512 before further headroom shrink.
    expect(config.maxTokens).toBeLessThanOrEqual(512);
    expect(config.maxTokens).toBeGreaterThanOrEqual(256);
    // Multi-step delete→list must stay bounded on small windows.
    expect(config.maxSteps).toBeLessThanOrEqual(6);

    const toolDefinitionTokens = estimateToolDefinitionTokens(ADMIN_TOOL_COUNT);
    const toolStepReserve = estimateAdminToolStepReserve(CONTEXT_WINDOW);
    // Even with a generous lower-bound on input (tools + reserve alone), the
    // route-chosen completion must still fit the window with a safety buffer.
    const estimatedInputFloor = toolDefinitionTokens + toolStepReserve;
    expect(
      promptFitsContextWindow({
        contextWindow: CONTEXT_WINDOW,
        estimatedInputTokens: estimatedInputFloor,
        maxOutputTokens: config.maxTokens ?? 0,
        safetyBuffer: 256,
      }),
    ).toBe(true);
  });

  it("rejects when the admin prompt cannot fit the 16k window", async () => {
    const { buildAdminSystemPrompt } = await import("~/lib/agent-tools");
    vi.mocked(buildAdminSystemPrompt).mockReturnValue("x".repeat(80_000));

    const res = await action(makeRequest(baseBody()));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ code: "ADMIN_CONTEXT_TOO_LARGE" });
    expect(streamText).not.toHaveBeenCalled();
  });
});
