// @vitest-environment node
// #1561 — a failed /api/chat request must not silently discard the user's
// typed message and leave behind an orphaned, empty "New conversation" chat
// row. `Chat` is created early, but the user's message used to be persisted
// (`appendMessages`) only *after* the provider-availability gates — so any
// gate failure (fleet unavailable, provider misconfigured/disabled) returned
// before the message was ever saved. The fix persists the user's message
// immediately once chat history is merged, before any of those gates can
// short-circuit the request, and echoes X-Chat-Id back on failure responses
// too so a client retry continues the same thread instead of spawning
// another orphaned chat.
import type { JsonObject, JsonValue } from "~/lib/json-value";
import type { RouteRequestBody } from "../helpers/route-fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  isPrivilegedChatMode: vi.fn().mockReturnValue(true),
  parseChatMode: vi.fn().mockReturnValue("admin"),
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
    chatMessage: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn(), createMany: vi.fn() },
    course: { findFirst: vi.fn(), findUnique: vi.fn() },
    aIModel: { findFirst: vi.fn() },
    systemConfig: { findUnique: vi.fn() },
  },
}));

// The #1279 boundary logs every mapped 5xx; stub the persistence side so the
// assertion reads the call rather than reaching for a database.
vi.mock("~/lib/logging.server", () => ({
  fireAndForget: (promise: Promise<unknown>) => void promise,
  logSystemError: vi.fn(async () => undefined),
}));

vi.mock("~/lib/api-keys/access.server", () => ({
  // #1571: admin chatMode re-checks isActive against the DB; keep the mocked
  // admin active so this suite's admin-mode failure paths stay admitted.
  isActiveAdminUser: vi.fn(async () => true),
}));

import { action } from "~/routes/api/chat";
import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";
import { FleetUnavailableError, resolveFleetHost } from "~/lib/ai/routing/fleet/resolve-fleet";
import { resetAiAdmission } from "~/lib/ai/admission.server";
import { resetRateLimitsForTests } from "~/lib/auth/rate-limit.server";
import { isActiveAdminUser } from "~/lib/api-keys/access.server";
import { logSystemError } from "~/lib/logging.server";

const NEW_CHAT_ID = "cjld2cjxh0000qzrmn831i7rn";
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

function baseBody(overrides: JsonObject = {}) {
  return {
    messages: [{ id: "msg-1", role: "user", content: "Explain recursion." }],
    model: "vllm:test-model",
    apiKeys: {},
    streaming: false,
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
  process.env.FLEET_STREAM_PROBE_MS = "20";

  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "user-1", role: "ADMIN" },
  } as never);
  vi.mocked(isActiveAdminUser).mockResolvedValue(true);

  // No `chatId` in the request body — the handler must create a brand-new
  // Chat row (the exact scenario in #1561's DB query: a fresh row with
  // `msg_count = 0`).
  vi.mocked(prisma.chat.create).mockResolvedValue({
    id: NEW_CHAT_ID,
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("#1561 — user message survives a provider-gate failure", () => {
  it("persists the user's message and returns X-Chat-Id when fleet resolution fails", async () => {
    vi.mocked(resolveFleetHost).mockRejectedValue(
      new FleetUnavailableError("No healthy server at http://private-fleet.internal"),
    );

    const res = await action(makeRequest(baseBody()));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("MODEL_UNAVAILABLE");

    // The chat row was created...
    expect(prisma.chat.create).toHaveBeenCalledTimes(1);
    // ...and, unlike the pre-fix behavior, the user's own message was saved
    // onto it before the fleet-resolution gate rejected the request. This is
    // the actual bug: the row must never come back with zero messages.
    expect(prisma.chatMessage.createMany).toHaveBeenCalledTimes(1);
    const createManyCall = vi.mocked(prisma.chatMessage.createMany).mock.calls[0]!;
    const persistedRows = createManyCall[0]!.data as Array<{
      chatId: string;
      role: string;
      messageId: string;
    }>;
    expect(persistedRows).toHaveLength(1);
    expect(persistedRows[0]).toMatchObject({
      chatId: NEW_CHAT_ID,
      role: "user",
      messageId: "msg-1",
    });

    // The client's `onResponse` reads X-Chat-Id to continue the same thread
    // on retry instead of spawning another orphaned "New conversation" row.
    expect(res.headers.get("X-Chat-Id")).toBe(NEW_CHAT_ID);
  });

  it("persists the user's message and returns X-Chat-Id when the provider is disabled", async () => {
    // No vllm base URL/API key configured at all — trips the
    // provider-registry gate rather than the fleet-resolution gate, exercising
    // the second early-return site that used to run before appendMessages.
    delete process.env.VLLM_BASE_URL;

    const res = await action(makeRequest(baseBody({ model: "openai:gpt-4o" })));

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(prisma.chat.create).toHaveBeenCalledTimes(1);
    expect(prisma.chatMessage.createMany).toHaveBeenCalledTimes(1);
    expect(res.headers.get("X-Chat-Id")).toBe(NEW_CHAT_ID);
  });

  // #1621 review: an exception that isn't routed through one of the explicit
  // rejectProviderFailure gates (e.g. resolveFleetHost throwing something
  // other than FleetUnavailableError, which the handler re-throws) falls
  // through to the outer catch-all instead. The user's message is already
  // persisted by then — the response must still carry X-Chat-Id, or a retry
  // spawns another orphaned chat despite nothing actually being lost.
  // #1560: the unrouted exception now escapes to the shared `withErrorResponse`
  // boundary instead of being converted in the route, so it takes the uniform
  // `{ error: "CODE" }` envelope and gets structured 5xx logging — while the
  // #1621 X-Chat-Id echo is preserved through the boundary's `headers` thunk.
  it("returns X-Chat-Id from the error boundary when an unrouted exception fires after persistence", async () => {
    vi.mocked(resolveFleetHost).mockRejectedValue(new Error("boom: not a FleetUnavailableError"));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await action(makeRequest(baseBody()));
    errorSpy.mockRestore();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "INTERNAL_ERROR" });
    expect(vi.mocked(logSystemError)).toHaveBeenCalledWith(
      expect.objectContaining({ source: "API", statusCode: 500 }),
    );

    expect(prisma.chat.create).toHaveBeenCalledTimes(1);
    expect(prisma.chatMessage.createMany).toHaveBeenCalledTimes(1);
    expect(res.headers.get("X-Chat-Id")).toBe(NEW_CHAT_ID);
  });
});
