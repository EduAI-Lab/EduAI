// @vitest-environment node
// Course-scope chat guardrail wiring in POST /api/chat: verifies the
// second-pass 7B classification short-circuits an off-topic turn with a
// canned redirect (skipping streamText/admission entirely), fails open on
// its own module boundary, and is skipped for admin-preview/service-key
// callers regardless of the enabled flag.
import type { JsonObject, JsonValue } from "~/lib/json-value";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RouteRequestBody } from "../helpers/route-fixtures";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: vi.fn(),
    createDataStreamResponse: vi.fn(({ execute, headers }) => {
      const chunks: string[] = [];
      const dataStream = {
        write: (part: string) => {
          chunks.push(part);
        },
      };
      execute(dataStream);
      return new Response(chunks.join(""), { status: 200, headers });
    }),
    formatDataStreamPart: vi.fn(
      (type: string, value: JsonValue) => `${type}:${JSON.stringify(value)}\n`,
    ),
    tool: vi.fn(<T>(definition: T) => definition),
  };
});

vi.mock("~/lib/ai/embedding", () => ({
  findRelevantContent: vi.fn().mockResolvedValue([]),
  generateEmbedding: vi.fn().mockResolvedValue([]),
  processMaterialEmbeddings: vi.fn(),
}));

vi.mock("~/lib/agent-tools", () => ({
  ADMIN_CORE_TOOL_NAMES: [],
  buildAdminSystemPrompt: vi.fn().mockReturnValue(""),
  buildInstructorSystemPrompt: vi.fn().mockReturnValue(""),
  chatbotTypeFromMode: vi.fn((mode: JsonValue) => (mode === "admin" ? "ADMIN" : "LEARNING")),
  createChatTools: vi.fn().mockReturnValue({}),
  isPrivilegedChatMode: vi.fn((mode: JsonValue) => mode === "admin" || mode === "instructor"),
  parseChatMode: vi.fn((v: JsonValue) => (v === "admin" ? "admin" : "learning")),
  pickCoreAdminChatTools: vi.fn((tools: JsonValue) => tools),
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
  resolveCourseAccessWithCourse: vi.fn().mockResolvedValue({
    course: {
      id: "course-1",
      isPublished: true,
      code: "COSC101",
      name: "Intro to Programming",
      description: "Fundamentals of programming.",
      aiInstructions: "",
      responseStyleTags: [],
      courseScopeGuardrailEnabled: true,
    },
    access: { level: "student", rank: 0 },
  }),
}));

vi.mock("~/lib/ai/providers.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/ai/providers.server")>();
  return {
    ...actual,
    getChatModelCapabilities: vi.fn().mockResolvedValue({
      supportsTools: false,
      maxTokens: null,
      name: null,
    }),
    modelSupportsTools: vi.fn().mockResolvedValue(false),
  };
});

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
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    chat: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    chatMessage: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn(), createMany: vi.fn() },
    course: { findFirst: vi.fn(), findUnique: vi.fn() },
    courseTopic: { findMany: vi.fn() },
    aIModel: { findFirst: vi.fn() },
    systemConfig: { findUnique: vi.fn() },
  },
}));

vi.mock("~/lib/user-provider-settings.server", () => ({
  getUserProviderSettings: vi.fn().mockResolvedValue({}),
}));

vi.mock("~/lib/ai/course-scope-guardrail", () => ({
  MAX_COURSE_SCOPE_HISTORY_TURNS: 6,
  courseScopeGuardrailEnabled: vi.fn().mockReturnValue(true),
  buildCourseScopePolicyPrompt: vi.fn(
    (context: { courseName: string }) => `SCOPE:${context.courseName}`,
  ),
  resolveCourseScopeVerdict: vi.fn().mockResolvedValue({ blocked: false, classification: null }),
  buildCourseScopeRedirectMessage: vi.fn((name: string | null) => `REDIRECT:${name}`),
}));

import { streamText } from "ai";
import { findRelevantContent } from "~/lib/ai/embedding";
vi.mock("~/lib/api-keys/access.server", () => ({
  // #1571: admin chatMode re-checks isActive against the DB; keep the mocked
  // admin active so this suite's admin-mode paths stay admitted.
  isActiveAdminUser: vi.fn(async () => true),
}));

import { action } from "~/routes/api/chat";
import { isActiveAdminUser } from "~/lib/api-keys/access.server";
import { auth } from "~/lib/auth/server";
import { resolveCourseAccessWithCourse } from "~/lib/auth/course-access.server";
import { requireServiceKey } from "~/lib/auth/guards.server";
import { resetRateLimitsForTests } from "~/lib/auth/rate-limit.server";
import prisma from "~/lib/prisma.server";
import { resolveCourseScopeVerdict } from "~/lib/ai/course-scope-guardrail";
import { encodeTextDataUrl } from "~/lib/chat/chat-attachments";
import { invalidateCourseTopicNamesCache } from "~/lib/courses/server";

const CHAT_ID = "cjld2cjxh0000qzrmn831i7rn";
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
  } as any;
}

function baseBody(overrides: JsonObject = {}) {
  return {
    messages: [{ id: "msg-1", role: "user", content: "What's due for assignment 2?" }],
    model: "vllm:test-model",
    apiKeys: {},
    streaming: false,
    chatId: CHAT_ID,
    courseId: COURSE_ID,
    ...overrides,
  };
}

function mockStream() {
  vi.mocked(streamText).mockResolvedValue({
    consumeStream: vi.fn().mockResolvedValue(undefined),
    text: Promise.resolve("Assignment 2 is due Friday."),
    usage: Promise.resolve({ promptTokens: 5, completionTokens: 10 }),
    finishReason: Promise.resolve("stop"),
    sources: Promise.resolve([]),
    reasoning: Promise.resolve(undefined),
    response: Promise.resolve({
      id: "resp-1",
      messages: [
        {
          id: "msg-1",
          role: "assistant",
          content: "Assignment 2 is due Friday.",
        },
      ],
    }),
  } as never);
}

function mockPriorCourseConversation(
  assistantContent = "A function packages reusable behavior.",
  userContent = "What is a function in Python?",
) {
  vi.mocked(prisma.chatMessage.findMany).mockResolvedValue([
    {
      messageId: "assistant-prior",
      role: "assistant",
      content: {
        id: "assistant-prior",
        role: "assistant",
        content: assistantContent,
      },
    },
    {
      messageId: "user-prior",
      role: "user",
      content: {
        id: "user-prior",
        role: "user",
        content: userContent,
      },
    },
  ] as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimitsForTests();
  vi.mocked(isActiveAdminUser).mockResolvedValue(true);
  process.env.VLLM_BASE_URL = "http://localhost:8001";
  // getCourseTopicNamesCached (lib/courses/server.ts) is a module-level cache
  // shared across tests in this file — clear it so each test's
  // prisma.courseTopic.findMany mock is actually exercised instead of a
  // prior test's cached result.
  invalidateCourseTopicNamesCache(COURSE_ID);

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
  vi.mocked(prisma.chat.create).mockResolvedValue({
    id: "new-chat-id",
    userId: "user-1",
    courseId: null,
    adhdAssist: false,
    systemPrompt: null,
  } as never);

  vi.mocked(prisma.chatMessage.findMany).mockResolvedValue([]);
  vi.mocked(prisma.chatMessage.createMany).mockResolvedValue({ count: 1 });
  vi.mocked(prisma.course.findUnique).mockResolvedValue({
    code: "COSC101",
  } as never);
  vi.mocked(prisma.courseTopic.findMany).mockResolvedValue([
    { name: "Functions", reviewStatus: "ACCEPTED" },
    { name: "Variables", reviewStatus: "ACCEPTED" },
  ] as never);
  // Retrieval covers the base question, so turns that pass the guardrail reach
  // the model instead of the #1936 no-coverage reply.
  vi.mocked(findRelevantContent).mockResolvedValue([
    { content: "Assignment 2 is due Friday.", similarity: 0.7, materialTitle: "Syllabus" },
  ]);
  vi.mocked(prisma.aIModel.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.systemConfig.findUnique).mockResolvedValue(null);
  vi.mocked(resolveCourseScopeVerdict).mockResolvedValue({
    blocked: false,
    classification: null,
  });
  mockStream();
});

describe("POST /api/chat — course-scope guardrail", () => {
  it("classifies by default and keeps the course-scope prompt on normal answers", async () => {
    const res = await action(makeRequest(baseBody()));

    expect(resolveCourseScopeVerdict).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          courseTopics: ["Functions", "Variables"],
        }),
      }),
    );
    expect(streamText).toHaveBeenCalledTimes(1);
    expect(vi.mocked(streamText).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        system: expect.stringContaining("SCOPE:Intro to Programming"),
      }),
    );
    expect(res.status).toBe(200);
  });

  it("passes recent stored conversation context for a natural follow-up", async () => {
    mockPriorCourseConversation();

    const res = await action(
      makeRequest(
        baseBody({
          messages: [
            {
              id: "follow-up",
              role: "user",
              content: "Explain that further.",
            },
          ],
        }),
      ),
    );

    expect(resolveCourseScopeVerdict).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Explain that further.",
        recentConversation: [
          { role: "user", content: "What is a function in Python?" },
          {
            role: "assistant",
            content: "A function packages reusable behavior.",
          },
        ],
      }),
    );
    expect(streamText).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });

  it("passes a long assistant answer for a follow-up about its final resource", async () => {
    const longBiologyAnswer = [
      "Support and resources available for BIOL 116.",
      "Study materials, office hours, discussion forums, tutoring, and lab sessions. ".repeat(20),
      "For calculations related to the course, the Math and Science Help Desk can assist.",
    ].join(" ");
    mockPriorCourseConversation(
      longBiologyAnswer,
      "What support and resources are available for BIOL 116?",
    );

    const res = await action(
      makeRequest(
        baseBody({
          messages: [
            {
              id: "biol-follow-up",
              role: "user",
              content: "Following up on Math and Science Help Desk",
            },
          ],
        }),
      ),
    );

    expect(resolveCourseScopeVerdict).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Following up on Math and Science Help Desk",
        recentConversation: [
          {
            role: "user",
            content: "What support and resources are available for BIOL 116?",
          },
          { role: "assistant", content: longBiologyAnswer },
        ],
      }),
    );
    expect(streamText).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });

  it.each([
    {
      label: "image-only",
      content: [
        {
          type: "image",
          image: "data:image/png;base64,AAAA",
        },
      ],
    },
    {
      label: "text-and-image",
      content: [
        { type: "text", text: "Explain this diagram." },
        {
          type: "image",
          image: "data:image/png;base64,AAAA",
        },
      ],
    },
  ])("rejects unsupported $label student turns explicitly", async ({ content }) => {
    const res = await action(
      makeRequest(
        baseBody({
          messages: [
            {
              id: "image-only",
              role: "user",
              content,
            },
          ],
        }),
      ),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "IMAGE_MESSAGE_UNSUPPORTED",
      message: "Course Chat does not support image messages.",
    });
    expect(resolveCourseScopeVerdict).not.toHaveBeenCalled();
    expect(streamText).not.toHaveBeenCalled();
    expect(prisma.chatMessage.createMany).not.toHaveBeenCalled();
  });

  it("skips the classifier when disabled for the course but keeps Layer A scope", async () => {
    vi.mocked(resolveCourseAccessWithCourse).mockResolvedValueOnce({
      course: {
        id: COURSE_ID,
        isPublished: true,
        code: "COSC101",
        name: "Intro to Programming",
        description: "Fundamentals of programming.",
        aiInstructions: "",
        responseStyleTags: [],
        courseScopeGuardrailEnabled: false,
      },
      access: { level: "student", rank: 0 },
    } as never);

    const res = await action(makeRequest(baseBody()));

    expect(resolveCourseScopeVerdict).not.toHaveBeenCalled();
    expect(vi.mocked(streamText).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        system: expect.stringContaining("SCOPE:Intro to Programming"),
      }),
    );
    expect(res.status).toBe(200);
  });

  it("redirects an off-topic turn instead of calling streamText, and persists the redirect", async () => {
    vi.mocked(resolveCourseScopeVerdict).mockResolvedValue({
      blocked: true,
      classification: { onTopic: false, confidence: 91 },
    });

    const res = await action(makeRequest(baseBody()));

    expect(streamText).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    // Parity with the persisted message and the history-restore path: the
    // non-streaming redirect response itself must also carry the redirect
    // marker, and the routed-model header so the client badge isn't blank.
    expect(res.headers.get("X-Routed-Model")).toBe("vllm:test-model");
    const body = await res.json();
    expect(body.content).toBe("REDIRECT:Intro to Programming");
    expect(body.courseScopeRedirect).toBe(true);

    expect(prisma.chatMessage.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            role: "assistant",
            content: expect.objectContaining({
              content: "REDIRECT:Intro to Programming",
              metadata: expect.objectContaining({ courseScopeRedirect: true }),
            }),
          }),
        ]),
      }),
    );
  });

  it("emits a complete data-stream redirect without calling streamText", async () => {
    vi.mocked(resolveCourseScopeVerdict).mockResolvedValue({
      blocked: true,
      classification: { onTopic: false, confidence: 96 },
    });

    const res = await action(makeRequest(baseBody({ streaming: true })));
    const body = await res.text();

    expect(streamText).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    // Every other createDataStreamResponse return in this route merges
    // autoRoutingHeaders(...); the redirect short-circuit must not be the one
    // path that leaves the client's model badge/routing telemetry blank.
    expect(res.headers.get("X-Routed-Model")).toBe("vllm:test-model");
    expect(body).toContain('text:"REDIRECT:Intro to Programming"');
    expect(body).toContain('finish_message:{"finishReason":"stop"}');
  });

  it("answers normally when the verdict is not blocked", async () => {
    vi.mocked(resolveCourseScopeVerdict).mockResolvedValue({
      blocked: false,
      classification: { onTopic: true, confidence: 95 },
    });

    const res = await action(makeRequest(baseBody()));

    expect(resolveCourseScopeVerdict).toHaveBeenCalledTimes(1);
    expect(streamText).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });

  it("skips the guardrail entirely for a service-key caller", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    vi.mocked(requireServiceKey).mockResolvedValue(null);

    const res = await action(
      makeRequest(
        baseBody({
          chatId: undefined,
        }),
      ),
    );

    expect(resolveCourseScopeVerdict).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("skips the guardrail entirely for admin chatMode", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    } as never);
    vi.mocked(prisma.aIModel.findFirst).mockResolvedValue({
      supportsTools: true,
      maxTokens: null,
      name: null,
    } as never);

    const res = await action(
      makeRequest(
        baseBody({
          chatMode: "admin",
          courseId: undefined,
          chatId: undefined,
        }),
      ),
    );

    expect(resolveCourseScopeVerdict).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("skips the classifier but still resolves course topics for admin preview with a real course", async () => {
    // Regression (#1152 review, yta3216): course topics were previously
    // fetched only when `!isServiceKeyCaller && chatMode !== "admin"`, so
    // admin-preview-with-course never loaded them — always rendering
    // "Topics: none listed" wherever topics are surfaced (e.g. the Layer A
    // policy prompt for non-admin course chat), even when the course had
    // topics. Topics are now loaded unconditionally alongside the rest of
    // effectiveCourse, decoupled from which gate downstream consumers use.
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    } as never);
    vi.mocked(prisma.aIModel.findFirst).mockResolvedValue({
      supportsTools: true,
      maxTokens: null,
      name: null,
    } as never);
    vi.mocked(prisma.courseTopic.findMany).mockResolvedValue([
      { name: "Functions", reviewStatus: "ACCEPTED" },
      { name: "Variables", reviewStatus: "ACCEPTED" },
    ] as never);

    const res = await action(
      makeRequest(
        baseBody({
          chatMode: "admin",
          chatId: undefined,
        }),
      ),
    );

    expect(resolveCourseScopeVerdict).not.toHaveBeenCalled();
    expect(prisma.courseTopic.findMany).toHaveBeenCalled();
    expect(res.status).toBe(200);
  });
});

describe("POST /api/chat — file attachments (#1902)", () => {
  const textAttachment = (name: string, text: string) => ({
    name,
    contentType: "text/plain",
    url: encodeTextDataUrl(text),
  });

  it("sends fenced attachment text to the model and persists the original message", async () => {
    mockStream();
    const res = await action(
      makeRequest(
        baseBody({
          messages: [
            {
              id: "with-file",
              role: "user",
              content: "Summarise my notes",
              parts: [{ type: "text", text: "Summarise my notes" }],
              experimental_attachments: [textAttachment("notes.md", "Functions return values.")],
            },
          ],
        }),
      ),
    );

    expect(res.status).toBe(200);
    const sent = JSON.stringify(vi.mocked(streamText).mock.calls[0]?.[0]?.messages);
    expect(sent).toContain('<student_attachment name=\\"notes.md\\">');
    expect(sent).toContain("Functions return values.");
    expect(sent).not.toContain("experimental_attachments");
    const persisted = JSON.stringify(vi.mocked(prisma.chatMessage.createMany).mock.calls[0]?.[0]);
    expect(persisted).toContain("experimental_attachments");
  });

  it("classifies course scope on the typed text only", async () => {
    mockStream();
    await action(
      makeRequest(
        baseBody({
          messages: [
            {
              id: "with-file",
              role: "user",
              content: "Summarise my notes",
              experimental_attachments: [textAttachment("notes.md", "UNRELATED BANANA TEXT")],
            },
          ],
        }),
      ),
    );
    expect(resolveCourseScopeVerdict).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Summarise my notes" }),
    );
  });

  it("rejects an image attachment with the existing image error before persisting", async () => {
    const res = await action(
      makeRequest(
        baseBody({
          messages: [
            {
              id: "img",
              role: "user",
              content: "what is this",
              experimental_attachments: [
                { name: "p.png", contentType: "image/png", url: "data:image/png;base64,AAAA" },
              ],
            },
          ],
        }),
      ),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "IMAGE_MESSAGE_UNSUPPORTED",
      message: "Course Chat does not support image messages.",
    });
    expect(streamText).not.toHaveBeenCalled();
    expect(prisma.chatMessage.createMany).not.toHaveBeenCalled();
  });

  it("rejects an image attachment on a non-last incoming turn before persisting", async () => {
    const res = await action(
      makeRequest(
        baseBody({
          messages: [
            {
              id: "a",
              role: "user",
              content: "x",
              experimental_attachments: [
                { name: "p.png", contentType: "image/png", url: "data:image/png;base64,AAAA" },
              ],
            },
            { id: "b", role: "user", content: "hi" },
          ],
        }),
      ),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "IMAGE_MESSAGE_UNSUPPORTED" });
    expect(streamText).not.toHaveBeenCalled();
    expect(prisma.chatMessage.createMany).not.toHaveBeenCalled();
  });

  it("rejects four attachments with ATTACHMENT_TOO_MANY before persisting", async () => {
    const res = await action(
      makeRequest(
        baseBody({
          messages: [
            {
              id: "many",
              role: "user",
              content: "q",
              experimental_attachments: ["1", "2", "3", "4"].map((n) =>
                textAttachment(`${n}.txt`, n),
              ),
            },
          ],
        }),
      ),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "ATTACHMENT_TOO_MANY" });
    expect(prisma.chatMessage.createMany).not.toHaveBeenCalled();
  });

  it("rejects attachments over the char budget with 413", async () => {
    process.env.CHAT_MAX_ATTACHMENT_CHARS = "10";
    try {
      const res = await action(
        makeRequest(
          baseBody({
            messages: [
              {
                id: "big",
                role: "user",
                content: "q",
                experimental_attachments: [textAttachment("a.txt", "x".repeat(11))],
              },
            ],
          }),
        ),
      );
      expect(res.status).toBe(413);
      expect(await res.json()).toMatchObject({ code: "ATTACHMENT_BUDGET_EXCEEDED" });
    } finally {
      delete process.env.CHAT_MAX_ATTACHMENT_CHARS;
    }
  });

  it("still includes a stored earlier attachment on a follow-up turn", async () => {
    mockStream();
    vi.mocked(prisma.chatMessage.findMany).mockResolvedValueOnce([
      {
        messageId: "earlier",
        role: "user",
        content: {
          id: "earlier",
          role: "user",
          content: "Here are my notes",
          experimental_attachments: [textAttachment("notes.md", "Stored attachment body")],
        },
      },
    ] as never);
    await action(
      makeRequest(
        baseBody({ messages: [{ id: "follow", role: "user", content: "Explain section 2" }] }),
      ),
    );
    const sent = JSON.stringify(vi.mocked(streamText).mock.calls[0]?.[0]?.messages);
    expect(sent).toContain("Stored attachment body");
    expect(sent).toContain('<student_attachment name=\\"notes.md\\">');
    expect(sent).not.toContain("experimental_attachments");
    expect(sent).not.toContain("data:text/plain");
  });

  it("collapses an attachment-bearing message to string content with no parts", async () => {
    mockStream();
    const big = "z".repeat(50_000);
    process.env.CHAT_MAX_ATTACHMENT_CHARS = "100000";
    try {
      const res = await action(
        makeRequest(
          baseBody({
            messages: [
              {
                id: "with-file",
                role: "user",
                content: "Summarise my notes",
                parts: [{ type: "text", text: "Summarise my notes" }],
                experimental_attachments: [textAttachment("big.txt", big)],
              },
            ],
          }),
        ),
      );
      expect(res.status).toBe(200);
      const messages = vi.mocked(streamText).mock.calls[0]?.[0]?.messages ?? [];
      const user = messages.find((m) => m.role === "user");
      expect(user).toBeDefined();
      expect(user).not.toHaveProperty("parts");
      expect(user?.content).toEqual(expect.any(String));
      expect(user?.content).toContain("Summarise my notes");
      expect(user?.content).toContain("<student_attachment");
    } finally {
      delete process.env.CHAT_MAX_ATTACHMENT_CHARS;
    }
  });

  it("budget-truncates the collapsed content when it overflows the context window", async () => {
    mockStream();
    const big = "z".repeat(400_000);
    process.env.CHAT_MAX_ATTACHMENT_CHARS = "500000";
    try {
      await action(
        makeRequest(
          baseBody({
            messages: [
              {
                id: "with-file",
                role: "user",
                content: "Summarise my notes",
                parts: [{ type: "text", text: "Summarise my notes" }],
                experimental_attachments: [textAttachment("big.txt", big)],
              },
            ],
          }),
        ),
      );
      const messages = vi.mocked(streamText).mock.calls[0]?.[0]?.messages ?? [];
      const user = messages.find((m) => m.role === "user");
      expect(user).not.toHaveProperty("parts");
      expect(String(user?.content).length).toBeLessThan(big.length);
    } finally {
      delete process.env.CHAT_MAX_ATTACHMENT_CHARS;
    }
  });

  it("retrieves course context with the typed text only, not the attachment", async () => {
    mockStream();
    await action(
      makeRequest(
        baseBody({
          messages: [
            {
              id: "with-file",
              role: "user",
              content: "Explain functions in Python please",
              experimental_attachments: [textAttachment("notes.md", "UNRELATED BANANA TEXT")],
            },
          ],
        }),
      ),
    );
    const queries = vi.mocked(findRelevantContent).mock.calls.map(([query]) => query);
    expect(queries.length).toBeGreaterThan(0);
    for (const query of queries) {
      expect(query).not.toContain("BANANA");
    }
  });
});
