// @vitest-environment node

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: vi.fn(),
    tool: vi.fn((definition: unknown) => definition),
  };
});

vi.mock("~/lib/ai/providers", () => ({
  createAIProviderRegistry: vi.fn(() => ({
    languageModel: vi.fn(() => ({ modelId: "test:model" })),
  })),
  listEnabledRegistryProviders: vi.fn(),
  mergeLocalInferenceFromEnv: vi.fn(() => ({
    test: { apiKey: "integration-test-key", isEnabled: true },
  })),
  parseModelIdentifier: vi.fn(() => ({ providerId: "test", modelId: "model" })),
}));

vi.mock("~/lib/ai/providers.server", () => ({
  capMaxOutputTokensForPrompt: vi.fn(),
  estimateTokensFromChars: vi.fn(),
  estimateToolDefinitionTokens: vi.fn(),
  estimateAdminToolStepReserve: vi.fn(),
  getChatModelCapabilities: vi.fn().mockResolvedValue({
    supportsTools: false,
    maxTokens: null,
    name: "Integration test model",
  }),
  promptFitsContextWindow: vi.fn(),
  resolveActiveChatModel: vi.fn(),
  resolveMaxOutputTokens: vi.fn(),
  resolveModelContextWindow: vi.fn(),
  ESTIMATED_CHARS_PER_TOKEN: 4,
}));

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/guards.server", () => ({
  enforceAdminIfApiKey: vi.fn().mockResolvedValue({ response: null, session: null }),
  requireServiceKey: vi.fn(),
}));

vi.mock("~/lib/auth/course-access.server", () => ({
  resolveCourseAccessWithCourse: vi.fn(),
}));

vi.mock("~/lib/agent-tools", () => ({
  buildAdminSystemPrompt: vi.fn(() => ""),
  chatbotTypeFromMode: vi.fn(() => "LEARNING"),
  createChatTools: vi.fn(() => ({})),
  parseChatMode: vi.fn(() => "learning"),
}));

vi.mock("~/lib/ai/chat-tools", () => ({
  buildChatToolRegistry: vi.fn(() => ({})),
  buildToolCallingSystemPrompt: vi.fn(({ basePrompt }) => basePrompt),
}));

vi.mock("~/lib/ai/embedding", () => ({
  findRelevantContent: vi.fn().mockResolvedValue([]),
}));

vi.mock("~/lib/ai/adhd-oversight", () => ({
  auditAndMaybeRewrite: vi.fn(),
  buildOverseenAssistantMessagesToPersist: vi.fn(() => []),
  emptyOversightAuditResult: vi.fn(),
  isAdhdOversightEnabled: vi.fn(() => false),
}));

vi.mock("~/lib/assistive-events.server", () => ({
  recordResponseComplianceEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/ai/energy/measurement.server", () => ({
  startSidecarMeasurement: vi.fn().mockResolvedValue(null),
}));

vi.mock("~/lib/ai/routing/telemetry.server", () => ({
  persistAiInteractionTelemetry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/policy.server", () => ({
  getPolicy: vi.fn().mockResolvedValue(false),
}));

vi.mock("~/lib/user-provider-settings.server", () => ({
  getUserProviderSettings: vi.fn().mockResolvedValue({
    test: { apiKey: "integration-test-key", isEnabled: true },
  }),
}));

import { streamText } from "ai";
import { listEnabledRegistryProviders } from "~/lib/ai/providers";
import { resolveCourseAccessWithCourse } from "~/lib/auth/course-access.server";
import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";
import { action } from "~/routes/api/chat";

let userId: string;
let courseId: string;

function chatRequest(chatId?: string) {
  return {
    request: new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          {
            id: "initial-message-id",
            role: "user",
            content: "Can you explain recursion?",
          },
        ],
        model: "test:model",
        streaming: false,
        courseId,
        ...(chatId ? { chatId } : {}),
      }),
    }),
    params: {},
    context: {} as never,
  } as never;
}

function successfulCompletion() {
  return {
    consumeStream: vi.fn().mockResolvedValue(undefined),
    text: Promise.resolve("Start with the base case."),
    usage: Promise.resolve({ promptTokens: 5, completionTokens: 7 }),
    finishReason: Promise.resolve("stop"),
    sources: Promise.resolve([]),
    reasoning: Promise.resolve(undefined),
    response: Promise.resolve({
      id: "response-id",
      messages: [
        {
          id: "assistant-message-id",
          role: "assistant",
          content: "Start with the base case.",
        },
      ],
    }),
  } as never;
}

beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8);
  const user = await prisma.user.create({
    data: {
      email: `chat-retry-${suffix}@ubc.ca`,
      name: "Chat Retry Integration",
      role: "STUDENT",
      emailVerified: false,
    },
  });
  userId = user.id;

  const course = await prisma.course.create({
    data: {
      name: "Chat Retry Integration",
      code: `CRI ${suffix}`,
      section: "001",
      term: "W1",
      year: 2026,
      startDate: new Date("2026-09-01"),
      isPublished: true,
    },
  });
  courseId = course.id;
});

afterAll(async () => {
  await prisma.chat.deleteMany({ where: { userId } });
  await prisma.course.delete({ where: { id: courseId } });
  await prisma.user.delete({ where: { id: userId } });
});

beforeEach(async () => {
  vi.clearAllMocks();
  await prisma.chat.deleteMany({ where: { userId } });

  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: userId, role: "STUDENT" },
  } as never);
  vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
    course: {
      id: courseId,
      code: "CRI",
      isPublished: true,
      responseStyleTags: [],
      aiInstructions: "",
    },
    access: { level: "student" },
  } as never);
  vi.mocked(listEnabledRegistryProviders).mockReturnValueOnce([]).mockReturnValue(["test"]);
  vi.mocked(streamText).mockResolvedValue(successfulCompletion());
});

describe("POST /api/chat initial retry idempotency (#1001)", () => {
  it("reuses the persisted chat across a 503-then-success sequence", async () => {
    const firstResponse = await action(chatRequest());

    expect(firstResponse.status).toBe(503);
    const persistedChatId = firstResponse.headers.get("X-Chat-Id");
    expect(persistedChatId).toBeTruthy();
    expect(await prisma.chat.count({ where: { userId } })).toBe(1);

    const retryResponse = await action(chatRequest(persistedChatId!));

    expect(retryResponse.status).toBe(200);
    expect((await retryResponse.json()).chatId).toBe(persistedChatId);
    expect(await prisma.chat.count({ where: { userId } })).toBe(1);
  });
});
