// @vitest-environment node
// Admin PATCH → persisted override → /api/chat 429 (#1557 review).
// Persistence is one in-memory SystemConfig map; the limiter is real.
vi.unmock("~/lib/chat-daily-limits.server");

import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const systemConfigStore = new Map<string, { key: string; value: string }>();

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
  requireAdmin: vi.fn(),
  enforceAdminIfApiKey: vi.fn().mockResolvedValue({ response: null, session: null }),
  requireServiceKey: vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ error: "MISSING_SERVICE_KEY" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }),
  ),
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
  fireAndForget: vi.fn((p: Promise<unknown>) => p),
  logSecurityEvent: vi.fn().mockResolvedValue(undefined),
  logAuditAction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/ai/admission.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/ai/admission.server")>();
  return {
    ...actual,
    acquireAiAdmission: vi.fn().mockResolvedValue({ release: () => {}, waitedMs: 0 }),
  };
});

vi.mock("~/lib/ai/routing/bedrock/bedrock-settings.server", () => ({
  getBedrockOverflowSettings: vi.fn().mockResolvedValue({
    enabled: false,
    dailyUserLimit: 0,
    monthlyUserLimit: 0,
    globalLimit: 0,
    resourceLimit: 0,
  }),
}));

vi.mock("~/lib/request-context.server", () => ({
  getActorContext: vi.fn(() => ({ actorId: "admin-1" })),
  getRequestContext: vi.fn(() => ({ routePath: "/api/admin/chat-daily-limits" })),
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    chat: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    chatMessage: { findMany: vi.fn(), createMany: vi.fn() },
    course: { findFirst: vi.fn(), findUnique: vi.fn() },
    courseTopic: { findMany: vi.fn().mockResolvedValue([]) },
    aIModel: { findFirst: vi.fn() },
    systemConfig: {
      findUnique: vi.fn(),
      findMany: vi.fn(async ({ where }: { where?: { key?: { in?: string[] } } }) => {
        const keys = where?.key?.in ?? [...systemConfigStore.keys()];
        return keys
          .map((key) => systemConfigStore.get(key))
          .filter((row): row is { key: string; value: string } => row !== undefined);
      }),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { key: string };
          create: { key: string; value: string };
          update: { value: string };
        }) => {
          const next = {
            key: where.key,
            value: update.value ?? create.value,
          };
          systemConfigStore.set(where.key, next);
          return next;
        },
      ),
    },
  },
}));

vi.mock("~/lib/user-provider-settings.server", () => ({
  getUserProviderSettings: vi.fn().mockResolvedValue({}),
}));

import { streamText } from "ai";
import { action as chatAction } from "~/routes/api/chat";
import { action as adminAction, loader as adminLoader } from "~/routes/api/admin.chat-daily-limits";
import { auth } from "~/lib/auth/server";
import { requireAdmin } from "~/lib/auth/guards.server";
import { resetRateLimitsForTests } from "~/lib/auth/rate-limit.server";
import prisma from "~/lib/prisma.server";
import { invalidateChatDailyLimitSettingsCache } from "~/lib/chat-daily-limits.server";
import { fireAndForget } from "~/lib/logging.server";
import { AdmissionTimeoutError, acquireAiAdmission } from "~/lib/ai/admission.server";
import { getBedrockOverflowSettings } from "~/lib/ai/routing/bedrock/bedrock-settings.server";

const CHAT_ID = "cjld2cjxh0000qzrmn831i7rn";
const COURSE_ID = "course-1";

function chatRequest(model = "vllm:test-model") {
  return {
    request: new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ id: "msg-1", role: "user", content: "Explain recursion." }],
        model,
        apiKeys: {},
        streaming: false,
        chatId: CHAT_ID,
        courseId: COURSE_ID,
      }),
    }),
    params: {},
    context: {} as never,
  } as never;
}

function adminRequest(method: string, body?: object) {
  return {
    request: new Request("http://localhost/api/admin/chat-daily-limits", {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    params: {},
    context: {} as never,
  } as never;
}

function asUser(userId: string, role: string) {
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: userId, role },
  } as never);
  vi.mocked(prisma.chat.findFirst).mockResolvedValue({
    id: CHAT_ID,
    userId,
    courseId: COURSE_ID,
    adhdAssist: false,
    systemPrompt: null,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  systemConfigStore.clear();
  resetRateLimitsForTests();
  invalidateChatDailyLimitSettingsCache();
  process.env.VLLM_BASE_URL = "http://localhost:8001";
  process.env.CHAT_RATE_LIMIT = "1000000";

  vi.mocked(requireAdmin).mockResolvedValue({
    response: null,
    session: { user: { id: "admin-1", role: "ADMIN" } },
  } as never);
  vi.mocked(acquireAiAdmission).mockResolvedValue({
    release: () => {},
    waitedMs: 0,
  } as never);
  vi.mocked(getBedrockOverflowSettings).mockResolvedValue({
    enabled: false,
    dailyUserLimit: 0,
    monthlyUserLimit: 0,
    globalLimit: 0,
    resourceLimit: 0,
  });

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
  } as never);

  vi.mocked(prisma.chatMessage.findMany).mockResolvedValue([]);
  vi.mocked(prisma.chatMessage.createMany).mockResolvedValue({ count: 1 });
  vi.mocked(prisma.course.findUnique).mockResolvedValue({ code: "COSC101" } as never);
  vi.mocked(prisma.aIModel.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.systemConfig.findUnique).mockResolvedValue(null);
});

afterEach(() => {
  resetRateLimitsForTests();
  invalidateChatDailyLimitSettingsCache();
  delete process.env.CHAT_RATE_LIMIT;
  delete process.env.AWS_BEARER_TOKEN_BEDROCK;
});

describe("admin daily cap → /api/chat 429 chain (#1557)", () => {
  it("loads the default 50/200 caps before any admin save", async () => {
    const loaded = await adminLoader(adminRequest("GET"));
    expect(loaded.status).toBe(200);
    await expect(loaded.json()).resolves.toMatchObject({
      settings: { studentLimit: 50, instructorLimit: 200 },
    });
  });

  it("persists a student cap of 1 and 429s the second local chat", async () => {
    asUser(`cap-chain-${randomUUID()}`, "STUDENT");

    const saved = await adminAction(
      adminRequest("PATCH", { studentLimit: 1, instructorLimit: 200 }),
    );
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({
      settings: { studentLimit: 1, instructorLimit: 200 },
    });

    const first = await chatAction(chatRequest());
    expect(first.status).toBe(200);

    const second = await chatAction(chatRequest());
    expect(second.status).toBe(429);
    await expect(second.json()).resolves.toMatchObject({ error: "RATE_LIMITED" });
  });

  it("persists an instructor cap of 1 and 429s the second instructor chat", async () => {
    asUser(`cap-chain-instr-${randomUUID()}`, "INSTRUCTOR");

    const saved = await adminAction(
      adminRequest("PATCH", { studentLimit: 50, instructorLimit: 1 }),
    );
    expect(saved.status).toBe(200);

    expect((await chatAction(chatRequest())).status).toBe(200);
    const second = await chatAction(chatRequest());
    expect(second.status).toBe(429);
    await expect(second.json()).resolves.toMatchObject({ error: "RATE_LIMITED" });
  });

  it("does not consume the local bucket for a cloud openai turn", async () => {
    asUser(`cap-chain-cloud-${randomUUID()}`, "STUDENT");

    await adminAction(adminRequest("PATCH", { studentLimit: 1, instructorLimit: 200 }));

    const cloud = await chatAction(chatRequest("openai:gpt-4o"));
    expect(cloud.status).not.toBe(429);

    expect((await chatAction(chatRequest())).status).toBe(200);
    const third = await chatAction(chatRequest());
    expect(third.status).toBe(429);
    await expect(third.json()).resolves.toMatchObject({ error: "RATE_LIMITED" });
  });

  it("rejects a non-admin PATCH", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({
      response: new Response(JSON.stringify({ error: "Forbidden: Admins only" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
      session: null,
    } as never);

    const denied = await adminAction(
      adminRequest("PATCH", { studentLimit: 1, instructorLimit: 200 }),
    );
    expect(denied.status).toBe(403);
    expect(systemConfigStore.size).toBe(0);
  });

  it("refunds the local cap when admission timeout overflows to Bedrock", async () => {
    // The cap is reserved after Auto routing picks a local model, before
    // admission. Overflow then runs on cloud, so the reservation must not
    // count — otherwise a 1/day student would 429 after a Bedrock turn.
    asUser(`cap-chain-overflow-${randomUUID()}`, "STUDENT");
    await adminAction(adminRequest("PATCH", { studentLimit: 1, instructorLimit: 200 }));

    process.env.AWS_BEARER_TOKEN_BEDROCK = "test-token";
    vi.mocked(getBedrockOverflowSettings).mockResolvedValue({
      enabled: true,
      dailyUserLimit: 0,
      monthlyUserLimit: 0,
      globalLimit: 0,
      resourceLimit: 20,
    });
    vi.mocked(acquireAiAdmission)
      .mockRejectedValueOnce(new AdmissionTimeoutError())
      .mockResolvedValue({ release: () => {}, waitedMs: 0 } as never);

    const overflowed = await chatAction(chatRequest());
    expect(overflowed.status).toBe(200);
    await Promise.all(
      vi
        .mocked(fireAndForget)
        .mock.results.map((result) => result.value)
        .filter((value) => value != null),
    );

    const localAfterRefund = await chatAction(chatRequest());
    expect(localAfterRefund.status).toBe(200);

    const exhausted = await chatAction(chatRequest());
    expect(exhausted.status).toBe(429);
    await expect(exhausted.json()).resolves.toMatchObject({ error: "RATE_LIMITED" });
  });
});
