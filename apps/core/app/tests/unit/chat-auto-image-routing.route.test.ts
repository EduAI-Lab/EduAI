// @vitest-environment node
// Route-level coverage for Auto-mode image-capability routing (#1403 review,
// item 4): existing routing-router.test.ts only exercises the router helper
// functions directly, but /api/chat itself catches router failures and
// retries with the rules-based fallback path (see the `resolveRoutedModel`
// try/catch around line ~1330) — a bug in that retry/fallback wiring is not
// visible from router-unit tests alone. These tests drive the real
// /api/chat action for admin and service-key Auto callers.
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

const { adminTools } = vi.hoisted(() => ({
  adminTools: { adminTool0: { description: "t0" } },
}));

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
  requireServiceKey: vi.fn().mockResolvedValue(null),
}));

vi.mock("~/lib/auth/course-access.server", () => ({
  resolveCourseAccessWithCourse: vi.fn(),
}));

const mockResolveRoutedModel = vi.hoisted(() => vi.fn());
const mockResolveRoutedModelRules = vi.hoisted(() => vi.fn());

vi.mock("~/lib/ai/routing/router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/ai/routing/router")>();
  return {
    ...actual,
    resolveRoutedModel: mockResolveRoutedModel,
    resolveRoutedModelRules: mockResolveRoutedModelRules,
  };
});

vi.mock("~/lib/ai/providers.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/ai/providers.server")>();
  return {
    ...actual,
    resolveActiveChatModel: vi.fn().mockResolvedValue({
      name: "Qwen 32B test",
      supportsTools: true,
      supportsImages: true,
      maxTokens: 16_384,
    }),
    getChatModelCapabilities: vi.fn().mockResolvedValue({
      supportsTools: true,
      supportsImages: true,
      maxTokens: 16_384,
      name: "Qwen 32B test",
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

vi.mock("~/lib/routing-model-settings.server", () => ({
  getRoutingModelSettings: vi.fn().mockResolvedValue({
    autoLlmEnabled: false,
    autoRulesEnabled: true,
  }),
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
import { requireServiceKey } from "~/lib/auth/guards.server";
import prisma from "~/lib/prisma.server";

const CHAT_ID = "cjld2cjxh0000qzrmn831i7rn";
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

const imageMessage = {
  id: "msg-1",
  role: "user",
  content: [
    { type: "text", text: "What is shown in this diagram?" },
    { type: "image", image: "data:image/png;base64,AAAA" },
  ],
};

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    messages: [imageMessage],
    model: "auto",
    streaming: false,
    chatId: CHAT_ID,
    chatMode: "admin",
    ...overrides,
  };
}

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

describe("POST /api/chat — Auto routing image-capability selection (#1403 review item 4)", () => {
  it("admin Auto mode selects an image-capable model when one exists", async () => {
    mockResolveRoutedModel.mockResolvedValue({
      modelId: "vllm:qwen3.5-32b",
      tier: 3,
      features: { routerVersion: "v1-rules", rule: "rule6_default_tier_1_energy", pickSource: "rules" },
    });

    const res = await action(makeRequest(baseBody()));

    expect(res.status).toBe(200);
    expect(mockResolveRoutedModel).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ imagesPresent: true }),
      undefined,
    );
    // The route must have used the router's chosen image-capable model, not
    // fallen back to rules-based re-resolution.
    expect(mockResolveRoutedModelRules).not.toHaveBeenCalled();
  });

  it("admin Auto mode rejects loudly when no image-capable model is available (no silent fallback)", async () => {
    const noImageModelError = new Error(
      "Auto routing has no active image-capable model in its routing tiers. Enable an image-capable tiered model in Admin → AI Models.",
    );
    mockResolveRoutedModel.mockRejectedValue(noImageModelError);
    mockResolveRoutedModelRules.mockRejectedValue(noImageModelError);

    const res = await action(makeRequest(baseBody()));

    // The route's catch-and-retry-with-rules wiring must not swallow this
    // into a 200 with a silently-downgraded text-only model — both the
    // primary resolver and the rules-based fallback report no image-capable
    // model, so the request must fail rather than proceed.
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(streamText).not.toHaveBeenCalled();
  });

  it("service-key Auto mode selects an image-capable model when one exists", async () => {
    // Service-key callers (AI Tutor / Question Maker) always hit "learning"
    // mode — "admin" chatMode is forbidden for service-key callers (see the
    // `chatMode === "admin" && isServiceKeyCaller` guard in chat.ts).
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    vi.mocked(requireServiceKey).mockResolvedValue(null);
    vi.mocked(prisma.chat.findFirst).mockResolvedValue({
      id: CHAT_ID,
      userId: "service",
      courseId: null,
      adhdAssist: false,
      systemPrompt: null,
      chatbotType: "LEARNING",
    } as never);

    mockResolveRoutedModel.mockResolvedValue({
      modelId: "vllm:qwen3.5-32b",
      tier: 3,
      features: { routerVersion: "v1-rules", rule: "rule6_default_tier_1_energy", pickSource: "rules" },
    });

    const res = await action(
      makeRequest(
        baseBody({
          chatMode: "learning",
          apiKeys: {},
        }),
      ),
    );

    expect(res.status).toBe(200);
    expect(mockResolveRoutedModel).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ imagesPresent: true }),
      undefined,
    );
  });
});

describe("POST /api/chat — explicit (non-Auto) model image-capability check (#1403 review item 3)", () => {
  it("rejects an image-bearing request against an explicitly-chosen text-only model", async () => {
    const { resolveActiveChatModel } = await import("~/lib/ai/providers.server");
    vi.mocked(resolveActiveChatModel).mockResolvedValue({
      name: "Qwen 7B test",
      supportsTools: true,
      supportsImages: false,
      maxTokens: 8192,
    });

    const res = await action(
      makeRequest(baseBody({ model: "vllm:qwen3.5-7b" })),
    );

    expect(res.status).toBe(400);
    const responseBody = await res.json();
    expect(responseBody.error).toBe("IMAGE_MODEL_UNSUPPORTED");
    expect(streamText).not.toHaveBeenCalled();
    // Auto routing must never even be consulted for an explicit model pick.
    expect(mockResolveRoutedModel).not.toHaveBeenCalled();
  });

  it("allows an image-bearing request against an explicitly-chosen image-capable model", async () => {
    const { resolveActiveChatModel } = await import("~/lib/ai/providers.server");
    vi.mocked(resolveActiveChatModel).mockResolvedValue({
      name: "Qwen 32B test",
      supportsTools: true,
      supportsImages: true,
      maxTokens: 16_384,
    });

    const res = await action(
      makeRequest(baseBody({ model: "vllm:qwen3.5-32b" })),
    );

    expect(res.status).toBe(200);
  });
});
