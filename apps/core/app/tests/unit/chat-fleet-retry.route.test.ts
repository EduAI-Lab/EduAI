// @vitest-environment node
// Fleet Slice 2: fleetRetry: true success marker only after alternate host succeeds.
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
  return { ...actual, fleetRoutingEnabled: vi.fn(() => true) };
});

vi.mock("~/lib/ai/routing/fleet/resolve-fleet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/ai/routing/fleet/resolve-fleet")>();
  return {
    ...actual,
    resolveFleetHost: vi.fn(),
    resolveFleetHostAfterFailure: vi.fn(),
  };
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

import { streamText } from "ai";
import { action } from "~/routes/api/chat";
import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";
import {
  resolveFleetHost,
  resolveFleetHostAfterFailure,
} from "~/lib/ai/routing/fleet/resolve-fleet";
import { resetAiAdmission } from "~/lib/ai/admission.server";
import { resetRateLimitsForTests } from "~/lib/auth/rate-limit.server";

const CHAT_ID = "cjld2cjxh0000qzrmn831i7rn";
const COURSE_ID = "course-1";
const originalEnergySidecarUrl = process.env.ENERGY_SIDECAR_URL;

const pick1 = {
  serverId: "cmps01",
  baseUrl: "http://cmps01.ok.ubc.ca:8001",
  reason: "interactive-round-robin",
};
const pick2 = {
  serverId: "cmps02",
  baseUrl: "http://cmps02.ok.ubc.ca:8001",
  reason: "interactive-round-robin-retry",
};

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

beforeEach(() => {
  vi.clearAllMocks();
  resetAiAdmission();
  resetRateLimitsForTests();
  process.env.VLLM_BASE_URL = "http://localhost:8001";
  process.env.AI_MAX_INFLIGHT = "0";
  // Soft-timeout so a successful streamText mock does not hang on probe.wait().
  process.env.FLEET_STREAM_PROBE_MS = "20";

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

  vi.mocked(resolveFleetHost).mockResolvedValue(pick1 as never);
  vi.mocked(resolveFleetHostAfterFailure).mockResolvedValue(pick2 as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalEnergySidecarUrl === undefined) {
    delete process.env.ENERGY_SIDECAR_URL;
  } else {
    process.env.ENERGY_SIDECAR_URL = originalEnergySidecarUrl;
  }
});

describe("Fleet Slice 2 retry success marker (#876)", () => {
  it("does not log fleetRetry: true when the alternate host also fails", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(streamText).mockImplementation(() => {
      throw new Error("connection refused");
    });

    const res = await action(makeRequest(baseBody()));
    expect(res.status).toBe(502);

    const body = await res.json();
    expect(body.code).toBe("LLM_STREAM_FAILED");
    expect(body.fleetRetry).toBe(false);

    const logMessages = logSpy.mock.calls.map((c) => String(c[0]));
    expect(logMessages.some((m) => m.includes("retry attempt"))).toBe(true);
    expect(logMessages.some((m) => m.includes("fleetRetry: true"))).toBe(false);

    expect(streamText).toHaveBeenCalledTimes(2);
    expect(resolveFleetHostAfterFailure).toHaveBeenCalledTimes(1);

  });

  it("logs fleetRetry: true only after the alternate attempt succeeds", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    process.env.ENERGY_SIDECAR_URL = "http://cmps01.ok.ubc.ca:8001/energy";
    vi.mocked(streamText)
      .mockImplementationOnce(() => {
        throw new Error("connection refused");
      })
      .mockImplementation((args) => {
        args.onChunk?.({} as never);
        args.onStepFinish?.({ toolCalls: [], toolResults: [] } as never);
        return {
          consumeStream: vi.fn().mockResolvedValue(undefined),
          text: Promise.resolve("Recovered on cmps02."),
          usage: Promise.resolve({ promptTokens: 5, completionTokens: 10 }),
          finishReason: Promise.resolve("stop"),
          sources: Promise.resolve([]),
          reasoning: Promise.resolve(undefined),
          response: Promise.resolve({
            id: "resp-1",
            messages: [{ id: "msg-1", role: "assistant", content: "Recovered on cmps02." }],
          }),
        } as never;
      });

    const res = await action(makeRequest(baseBody()));
    expect(res.status).toBe(200);

    const logMessages = logSpy.mock.calls.map((c) => String(c[0]));
    expect(logMessages.some((m) => m.includes("retry attempt"))).toBe(true);
    expect(logMessages.some((m) => m.includes("fleetRetry: true"))).toBe(true);
    const sidecarCalls = fetchSpy.mock.calls.filter(([input]) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      return url.includes("/measure-start") || url.includes("/measure-stop");
    });
    expect(sidecarCalls).toHaveLength(0);

    const successIdx = logMessages.findIndex((m) => m.includes("fleetRetry: true"));
    const attemptIdx = logMessages.findIndex((m) => m.includes("retry attempt"));
    expect(attemptIdx).toBeGreaterThanOrEqual(0);
    expect(successIdx).toBeGreaterThan(attemptIdx);
  }, 15_000);
});
