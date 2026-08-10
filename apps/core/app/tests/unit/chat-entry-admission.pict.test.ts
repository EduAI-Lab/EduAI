// @vitest-environment node
//
// PICT drift-contract adapter (#1182, census docs/PICT_CENSUS.md § S3): one committed
// row table (tests/models/chat-entry-admission.cases.json) and one spec-derived oracle
// assert POST /api/chat admission gates — auth, proxyUser, admin chatMode, publish/
// enrollment, course-id source (404 vs 403), chatbotType mismatch / not-found (410),
// course-pin conflict (409) — via mocked session/prisma/course-access like
// chat.rbac.test.ts (no live DB).

import { describe, it, expect, vi, beforeEach } from "vitest";

const routingSettingsMock = vi.hoisted(() => ({
  getRoutingModelSettings: vi.fn(),
}));

vi.mock("@ai-sdk/openai", () => ({ createOpenAI: vi.fn() }));
vi.mock("@ai-sdk/google", () => ({ createGoogleGenerativeAI: vi.fn() }));
vi.mock("ollama-ai-provider", () => ({ createOllama: vi.fn() }));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: vi.fn(),
    createDataStreamResponse: vi.fn(),
    formatDataStreamPart: vi.fn((_type: string, value: unknown) => String(value)),
    tool: vi.fn((definition: unknown) => definition),
    embed: vi.fn(),
    embedMany: vi.fn(),
  };
});

vi.mock("~/lib/ai/embedding", () => ({
  findRelevantContent: vi.fn().mockResolvedValue([]),
}));

vi.mock("~/lib/ai/providers", () => ({
  createAIProviderRegistry: vi.fn().mockReturnValue({}),
  listEnabledRegistryProviders: vi.fn().mockReturnValue([]),
  mergeLocalInferenceFromEnv: vi.fn().mockReturnValue([]),
  parseModelIdentifier: vi.fn().mockReturnValue({ providerId: "openai", modelId: "gpt-4o-mini" }),
}));

vi.mock("~/lib/ai/providers.server", () => ({
  getChatModelCapabilities: vi.fn().mockResolvedValue({
    supportsTools: false,
    maxTokens: null,
    name: null,
  }),
  resolveActiveChatModel: vi.fn(),
  capMaxOutputTokensForPrompt: vi.fn(),
  estimateTokensFromChars: vi.fn().mockReturnValue(0),
  estimateToolDefinitionTokens: vi.fn().mockReturnValue(0),
  estimateAdminToolStepReserve: vi.fn().mockReturnValue(0),
  promptFitsContextWindow: vi.fn().mockReturnValue(true),
  resolveMaxOutputTokens: vi.fn().mockReturnValue(1024),
  resolveModelContextWindow: vi.fn().mockReturnValue(8192),
  ESTIMATED_CHARS_PER_TOKEN: 4,
}));

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/guards.server", () => ({
  enforceAdminIfApiKey: vi.fn().mockResolvedValue({ response: null, session: null }),
  requireServiceKey: vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ error: "MISSING_SERVICE_KEY" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }),
  ),
}));

vi.mock("~/lib/auth/course-access.server", () => ({
  resolveCourseAccessWithCourse: vi.fn(),
}));

vi.mock("~/lib/routing-model-settings.server", () => routingSettingsMock);

vi.mock("~/lib/prisma.server", () => ({
  default: {
    chat: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    chatMessage: { findMany: vi.fn().mockResolvedValue([]) },
    course: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    externalUser: { findUnique: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn(), create: vi.fn() },
  },
}));

import { action } from "~/routes/api/chat";
import { auth } from "~/lib/auth/server";
import { enforceAdminIfApiKey, requireServiceKey } from "~/lib/auth/guards.server";
import { resolveCourseAccessWithCourse } from "~/lib/auth/course-access.server";
import prisma from "~/lib/prisma.server";
import { resetRateLimitsForTests } from "~/lib/auth/rate-limit.server";
import chatEntryAdmissionCases from "../../../../../tests/models/chat-entry-admission.cases.json";
import {
  expectedChatAdmissionStatus,
  type ChatEntryAdmissionRow,
} from "../../../../../tests/models/chat-entry-admission.oracle";

const rows = chatEntryAdmissionCases as ChatEntryAdmissionRow[];

const COURSE_ID = "course-1";
const COURSE_PINNED = "course-pinned";
const COURSE_REQUEST = "course-request";
const CHAT_ID = "chat-existing";
const PROXY_USER_ID = "proxy-user-1";

const COURSE = {
  id: COURSE_ID,
  isPublished: true,
  department: null,
  responseStyleTags: [],
  aiInstructions: null,
};

function mockCourseAccess(row: ChatEntryAdmissionRow) {
  const isPublished = row.CoursePublished === "yes";
  const course = { ...COURSE, isPublished };

  if (row.CourseIdSource === "body-missing") {
    vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
      course: null,
      access: null,
    } as never);
    return;
  }

  if (row.CourseIdSource === "none") {
    return;
  }

  if (row.Enrollment === "none") {
    if (row.Auth === "service-key" || row.Auth === "admin-api-key") {
      vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
        course: course as never,
        access: { level: "admin", rank: 4 } as never,
      });
    } else {
      vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
        course: course as never,
        access: null,
      } as never);
    }
    return;
  }

  const access =
    row.Enrollment === "instructor"
      ? { level: "instructor", rank: 2 }
      : { level: "student", rank: 0 };

  vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
    course: course as never,
    access: access as never,
  });
}

function configureAuth(row: ChatEntryAdmissionRow) {
  vi.mocked(enforceAdminIfApiKey).mockResolvedValue({ response: null, session: null });
  vi.mocked(requireServiceKey).mockResolvedValue(
    new Response(JSON.stringify({ error: "MISSING_SERVICE_KEY" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }),
  );

  switch (row.Auth) {
    case "none":
      vi.mocked(auth.api.getSession).mockResolvedValue(null);
      break;
    case "service-key":
      vi.mocked(auth.api.getSession).mockResolvedValue(null);
      vi.mocked(requireServiceKey).mockResolvedValue(null);
      break;
    case "admin-api-key":
      vi.mocked(auth.api.getSession).mockResolvedValue(null);
      vi.mocked(enforceAdminIfApiKey).mockResolvedValue({
        response: null,
        session: { user: { id: "api-admin", role: "ADMIN", name: "API Admin" } } as never,
      });
      break;
    case "session":
      if (row.ChatMode === "admin") {
        vi.mocked(auth.api.getSession).mockResolvedValue({
          user: { id: "admin-1", role: "ADMIN", name: "Admin" },
        } as never);
      } else {
        vi.mocked(auth.api.getSession).mockResolvedValue({
          user: { id: "u1", role: "STUDENT", name: "Student" },
        } as never);
      }
      break;
  }

  if (row.ProxyUser === "valid") {
    const proxiedRole = row.Enrollment === "instructor" ? "INSTRUCTOR" : "STUDENT";
    vi.mocked(prisma.externalUser.findUnique).mockResolvedValue({
      id: "mapping-1",
      email: `${PROXY_USER_ID}@aitutor.local`,
      user: {
        id: PROXY_USER_ID,
        email: `${PROXY_USER_ID}@aitutor.local`,
        name: "Proxied",
        role: proxiedRole,
      },
    } as never);
  } else {
    vi.mocked(prisma.externalUser.findUnique).mockResolvedValue(null);
  }
}

function configurePersistedChat(row: ChatEntryAdmissionRow, userId: string) {
  if (row.PersistedChat === "none") {
    vi.mocked(prisma.chat.findFirst).mockResolvedValue(null);
    return;
  }

  if (row.PersistedChat === "not-found") {
    vi.mocked(prisma.chat.findFirst).mockResolvedValue(null);
    return;
  }

  const expectedType = row.ChatMode === "admin" ? "ADMIN" : "LEARNING";
  const chatbotType =
    row.PersistedChat === "type-mismatch"
      ? expectedType === "ADMIN"
        ? "LEARNING"
        : "ADMIN"
      : expectedType;
  const courseId =
    row.PersistedChat === "pin-conflict"
      ? COURSE_PINNED
      : row.CourseIdSource === "persisted" || row.PersistedChat === "ok"
        ? COURSE_ID
        : COURSE_ID;

  vi.mocked(prisma.chat.findFirst).mockResolvedValue({
    id: CHAT_ID,
    userId,
    chatbotType,
    courseId,
    systemPrompt: null,
    adhdAssist: false,
  } as never);
}

function actingUserId(row: ChatEntryAdmissionRow): string {
  if (row.ProxyUser === "valid") return PROXY_USER_ID;
  if (row.Auth === "service-key") return "service";
  if (row.Auth === "admin-api-key") return "api-admin";
  if (row.ChatMode === "admin") return "admin-1";
  return "u1";
}

function buildBody(row: ChatEntryAdmissionRow): Record<string, unknown> {
  const body: Record<string, unknown> = {
    messages: [],
    model: "auto-llm",
  };

  if (row.ChatMode === "admin") {
    body.chatMode = "admin";
  }

  if (row.CourseIdSource === "body" || row.CourseIdSource === "body-missing") {
    body.courseId = row.PersistedChat === "pin-conflict" ? COURSE_REQUEST : COURSE_ID;
  }

  if (row.PersistedChat === "pin-conflict") {
    body.courseId = COURSE_REQUEST;
    body.chatId = CHAT_ID;
  } else if (row.PersistedChat !== "none") {
    body.chatId = CHAT_ID;
    if (row.CourseIdSource === "body" || row.CourseIdSource === "body-missing") {
      body.courseId = COURSE_ID;
    }
  }

  if (row.ProxyUser === "valid") {
    body.proxyUser = { id: PROXY_USER_ID, provider: "aitutor" };
  } else if (row.ProxyUser === "blocked") {
    body.proxyUser = { id: PROXY_USER_ID, provider: "aitutor" };
  }

  return body;
}

function makeArgs(body: Record<string, unknown>) {
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

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimitsForTests();
  routingSettingsMock.getRoutingModelSettings.mockResolvedValue({
    autoLlmEnabled: true,
    autoRulesEnabled: false,
  });
  vi.mocked(prisma.course.findUnique).mockResolvedValue({
    code: "COSC 101",
  } as never);
  vi.mocked(prisma.chatMessage.findMany).mockResolvedValue([]);
});

describe.each(rows.map((row, index) => ({ row, index })))(
  "chat-entry-admission PICT row #$index $row.Auth/$row.CourseIdSource/$row.Enrollment/$row.PersistedChat",
  ({ row }) => {
    it("matches the oracle admission verdict via POST /api/chat", async () => {
      configureAuth(row);
      mockCourseAccess(row);
      configurePersistedChat(row, actingUserId(row));

      const res = await action(makeArgs(buildBody(row)));
      expect(res.status).toBe(expectedChatAdmissionStatus(row));
    });
  },
);
