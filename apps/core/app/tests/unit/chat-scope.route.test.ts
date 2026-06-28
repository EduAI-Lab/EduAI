// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: vi.fn(),
    createDataStreamResponse: vi.fn(({ execute, headers }) => {
      const chunks: string[] = [];
      const dataStream = { write: (part: string) => { chunks.push(part); } };
      execute(dataStream);
      return new Response(chunks.join(""), { status: 200, headers });
    }),
    formatDataStreamPart: vi.fn((type: string, value: unknown) =>
      type === "text" ? String(value) : JSON.stringify(value),
    ),
    tool: vi.fn((definition: unknown) => definition),
  };
});

vi.mock("~/lib/ai/embedding", () => ({
  findRelevantContent: vi.fn().mockResolvedValue([]),
}));

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/guards.server", () => ({
  enforceAdminIfApiKey: vi.fn().mockResolvedValue({ response: null, session: null }),
}));

vi.mock("~/lib/auth/course-access.server", () => ({
  resolveCourseAccessWithCourse: vi.fn().mockResolvedValue({
    course: {
      id: "course-1",
      code: "COSC 121",
      name: "Intro Programming",
      description: null,
      aiInstructions: null,
      isPublished: true,
    },
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

vi.mock("~/lib/prisma.server", () => ({
  default: {
    chat: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    chatMessage: { findMany: vi.fn(), createMany: vi.fn() },
    course: { findFirst: vi.fn() },
    courseTopic: { findMany: vi.fn() },
    systemConfig: { findUnique: vi.fn() },
  },
}));

import { streamText } from "ai";
import { action } from "~/routes/api/chat";
import { auth } from "~/lib/auth/server";
import { resolveCourseAccessWithCourse } from "~/lib/auth/course-access.server";
import { findRelevantContent } from "~/lib/ai/embedding";
import { getChatModelCapabilities } from "~/lib/ai/providers.server";
import prisma from "~/lib/prisma.server";

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
  };
}

function mockStream() {
  vi.mocked(streamText).mockResolvedValue({
    consumeStream: vi.fn().mockResolvedValue(undefined),
    text: Promise.resolve("The answer."),
    usage: Promise.resolve({ promptTokens: 5, completionTokens: 10 }),
    finishReason: Promise.resolve("stop"),
    sources: Promise.resolve([]),
    reasoning: Promise.resolve(undefined),
    response: Promise.resolve({
      id: "resp-1",
      messages: [{ id: "msg-1", role: "assistant", content: "The answer." }],
    }),
    toDataStreamResponse: vi.fn(() => new Response("stream", { status: 200 })),
  } as never);
}

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    messages: [{ id: "msg-1", role: "user", content: "What is gradient descent?" }],
    model: "vllm:test-model",
    apiKeys: {},
    streaming: false,
    chatId: CHAT_ID,
    courseId: COURSE_ID,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.CHAT_SCOPE_ZERO_CHUNK_GATE;
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

  vi.mocked(prisma.chat.update).mockImplementation(
    (async (args: { data?: Record<string, unknown> }) => ({
      id: CHAT_ID,
      userId: "user-1",
      courseId: COURSE_ID,
      adhdAssist: false,
      systemPrompt: null,
      ...(args.data ?? {}),
    })) as never,
  );

  vi.mocked(prisma.chatMessage.findMany).mockResolvedValue([]);
  vi.mocked(prisma.chatMessage.createMany).mockResolvedValue({ count: 1 });
  vi.mocked(prisma.systemConfig.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.courseTopic.findMany).mockResolvedValue([
    { name: "loops" },
    { name: "arrays" },
  ] as never);

  vi.mocked(getChatModelCapabilities).mockResolvedValue({
    supportsTools: false,
    maxTokens: null,
    name: null,
  });
});

describe("POST /api/chat — course scope gate (#729)", () => {
  it("hard-refuses off-topic questions with zero RAG hits without calling the model", async () => {
    vi.mocked(findRelevantContent).mockResolvedValue([]);
    mockStream();

    const res = await action(
      makeRequest(
        baseBody({
          messages: [
            {
              id: "msg-1",
              role: "user",
              content: "How do I bake chocolate chip cookies from scratch?",
            },
          ],
        }),
      ),
    );

    expect(res.status).toBe(200);
    expect(streamText).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.content).toContain("COSC 121");
    expect(body.content).toContain("unrelated topics");
    expect(prisma.chatMessage.createMany).toHaveBeenCalled();
  });

  it("hard-refuses general knowledge questions with zero RAG hits", async () => {
    vi.mocked(findRelevantContent).mockResolvedValue([]);
    mockStream();

    const res = await action(
      makeRequest(
        baseBody({
          messages: [
            {
              id: "msg-1",
              role: "user",
              content: "Tell me about World War 2",
            },
          ],
        }),
      ),
    );

    expect(res.status).toBe(200);
    expect(streamText).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.content).toContain("unrelated topics");
  });

  it("hard-refuses off-topic questions even when RAG returns weak hits", async () => {
    vi.mocked(findRelevantContent).mockResolvedValue([
      { content: "misc", similarity: 0.42, materialTitle: "Syllabus" },
    ]);
    mockStream();

    const res = await action(
      makeRequest(
        baseBody({
          messages: [
            {
              id: "msg-1",
              role: "user",
              content: "What is the capital of France?",
            },
          ],
        }),
      ),
    );

    expect(res.status).toBe(200);
    expect(streamText).not.toHaveBeenCalled();
  });

  it("allows greetings with zero RAG hits", async () => {
    vi.mocked(findRelevantContent).mockResolvedValue([]);
    mockStream();

    const res = await action(
      makeRequest(
        baseBody({
          messages: [{ id: "msg-1", role: "user", content: "hello" }],
        }),
      ),
    );

    expect(res.status).toBe(200);
    expect(streamText).toHaveBeenCalled();
  });

  it("allows on-topic questions when RAG returns hits", async () => {
    vi.mocked(findRelevantContent).mockResolvedValue([
      { content: "gradient descent minimizes loss", similarity: 0.72, materialTitle: "Lecture 3" },
    ]);
    mockStream();

    const res = await action(makeRequest(baseBody()));
    expect(res.status).toBe(200);
    expect(streamText).toHaveBeenCalled();
    const config = vi.mocked(streamText).mock.calls.at(-1)?.[0] as { system?: string };
    expect(config.system).toContain("COSC 121");
    expect(config.system).toContain("SCOPE POLICY");
  });

  it("allows related foundational questions with zero RAG hits", async () => {
    vi.mocked(findRelevantContent).mockResolvedValue([]);
    mockStream();

    const res = await action(
      makeRequest(
        baseBody({
          messages: [
            {
              id: "msg-1",
              role: "user",
              content: "What is linear algebra?",
            },
          ],
        }),
      ),
    );

    expect(res.status).toBe(200);
    expect(streamText).toHaveBeenCalled();
    const config = vi.mocked(streamText).mock.calls.at(-1)?.[0] as { system?: string };
    expect(config.system).toContain("foundational");
  });

  it("allows concept follow-ups when prior assistant turn was course-related", async () => {
    vi.mocked(findRelevantContent).mockResolvedValue([]);
    mockStream();

    const res = await action(
      makeRequest(
        baseBody({
          messages: [
            {
              id: "msg-1",
              role: "user",
              content: "what is chapter 1 about?",
            },
            {
              id: "msg-2",
              role: "assistant",
              content:
                "Chapter 1 covers binary representation and ASCII encoding for text.",
            },
            {
              id: "msg-3",
              role: "user",
              content: "why was ascii created?",
            },
          ],
        }),
      ),
    );

    expect(res.status).toBe(200);
    expect(streamText).toHaveBeenCalled();
  });

  it("allows generic coding help without course keywords (Layer A handles scope)", async () => {
    vi.mocked(findRelevantContent).mockResolvedValue([]);
    mockStream();

    const res = await action(
      makeRequest(
        baseBody({
          messages: [
            {
              id: "msg-1",
              role: "user",
              content: "Write Python code to sort a list of countries by population",
            },
          ],
        }),
      ),
    );

    expect(res.status).toBe(200);
    expect(streamText).toHaveBeenCalled();
  });

  it("allows coding help with zero RAG hits when course-framed", async () => {
    vi.mocked(findRelevantContent).mockResolvedValue([]);
    mockStream();

    const res = await action(
      makeRequest(
        baseBody({
          messages: [
            {
              id: "msg-1",
              role: "user",
              content: "Can you debug my JavaScript function for the assignment?",
            },
          ],
        }),
      ),
    );

    expect(res.status).toBe(200);
    expect(streamText).toHaveBeenCalled();
  });
});

describe("superbolt08 screenshot regression (#729)", () => {
  const screenshotPrompts = [
    "i need to know how i can limit social media time",
    "why is it that walking everyday improves overall health?",
    "where was world war II held?",
    "how many people attended world war ii",
  ];

  beforeEach(() => {
    vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
      course: {
        id: "course-1",
        code: "COSC 121",
        name: "Computer Programming II",
        description: "Second-year programming course.",
        aiInstructions: null,
        isPublished: true,
      },
      access: { level: "student" },
    } as never);
  });

  it.each(screenshotPrompts)(
    "returns canned refusal without calling the model: %s",
    async (content) => {
      vi.mocked(findRelevantContent).mockResolvedValue([]);
      mockStream();

      const res = await action(
        makeRequest(baseBody({ messages: [{ id: "msg-1", role: "user", content }] })),
      );

      expect(res.status).toBe(200);
      expect(streamText).not.toHaveBeenCalled();
      const body = await res.json();
      expect(body.content).toContain("COSC 121");
      expect(body.content).toContain("unrelated topics");
      expect(body.content).not.toContain("Cardiovascular Health");
      expect(body.content).not.toContain("Europe, Asia");
    },
  );

  it.each(screenshotPrompts)(
    "still refuses when RAG returns moderate hits: %s",
    async (content) => {
      vi.mocked(findRelevantContent).mockResolvedValue([
        { content: "misc", similarity: 0.62, materialTitle: "Syllabus" },
      ]);
      mockStream();

      const res = await action(
        makeRequest(baseBody({ messages: [{ id: "msg-1", role: "user", content }] })),
      );

      expect(res.status).toBe(200);
      expect(streamText).not.toHaveBeenCalled();
    },
  );
});
