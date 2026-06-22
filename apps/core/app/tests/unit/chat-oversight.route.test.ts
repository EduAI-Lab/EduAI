// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

vi.mock("~/lib/ai/adhd-oversight", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/ai/adhd-oversight")>();
  return {
    ...actual,
    auditAndMaybeRewrite: vi.fn(),
  };
});

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/guards.server", () => ({}));

// #657: chat is course-scoped. These oversight tests run a course-tagged chat,
// so the acting student passes the course-access gate.
vi.mock("~/lib/auth/course-access.server", () => ({
  resolveCourseAccessWithCourse: vi.fn().mockResolvedValue({
    course: { id: "c1", isPublished: true },
    access: { level: "student", rank: 0 },
  }),
}));

vi.mock("~/lib/ai/providers.server", () => ({
  modelSupportsTools: vi.fn().mockResolvedValue(false),
}));

vi.mock("~/lib/assistive-events.server", () => ({
  recordResponseComplianceEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
	    chat: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
	    chatMessage: { findMany: vi.fn(), createMany: vi.fn() },
	    course: { findFirst: vi.fn() },
	    systemConfig: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
	  },
	}));

import { streamText } from "ai";
import { action } from "~/routes/api/chat";
import { auth } from "~/lib/auth/server";
	import { auditAndMaybeRewrite } from "~/lib/ai/adhd-oversight";
	import { withStructuralPass, computeAdhdResponseMetrics } from "~/lib/ai/adhd-metrics";
	import { invalidatePolicyCache } from "~/lib/policy.server";
	import prisma from "~/lib/prisma.server";

const CHAT_ID = "cjld2cjxh0000qzrmn831i7rn";
const USER_ID = "user-1";
const DRAFT = "Answer without structural anchors.";
const OVERSEEN = `**Top summary**
- Fixed point

**Next?** Want to continue?`;

const originalVllm = process.env.VLLM_BASE_URL;

function makeArgs(body: object) {
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

function mockAuditResult(text: string = OVERSEEN) {
  const metrics = withStructuralPass(computeAdhdResponseMetrics(text));
  vi.mocked(auditAndMaybeRewrite).mockResolvedValue({
    text,
    rewritten: true,
    method: "deterministic",
    beforeMetrics: metrics,
    afterMetrics: metrics,
    oversightDurationMs: 0,
    oversightUsage: null,
  });
}

function mockStreamResult(args: {
  text: string;
  messages?: Array<{ id: string; role: string; content: unknown }>;
}) {
  vi.mocked(streamText).mockResolvedValue({
    consumeStream: vi.fn().mockResolvedValue(undefined),
    text: Promise.resolve(args.text),
    usage: Promise.resolve({ promptTokens: 5, completionTokens: 10 }),
    finishReason: Promise.resolve("stop"),
    sources: Promise.resolve([]),
    reasoning: Promise.resolve(undefined),
    response: Promise.resolve({
      id: "resp-1",
      messages: args.messages ?? [
        { id: "tool-step", role: "assistant", content: [{ type: "tool-call" }] },
        { id: "final-step", role: "assistant", content: args.text },
      ],
    }),
  } as never);
}

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    messages: [{ id: "user-1", role: "user", content: "Explain tax brackets" }],
    model: "vllm:test-model",
    apiKeys: {},
    adhdAssist: true,
    streaming: false,
    chatId: CHAT_ID,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
	  process.env.VLLM_BASE_URL = "http://localhost:8001";
	  process.env.ADHD_ASSIST_OVERSIGHT = "true";
	  invalidatePolicyCache();

  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: USER_ID, role: "STUDENT" },
  } as never);

  vi.mocked(prisma.chat.findFirst).mockResolvedValue({
    id: CHAT_ID,
    userId: USER_ID,
    courseId: "c1",
    adhdAssist: true,
    systemPrompt: null,
  } as never);

	  vi.mocked(prisma.chatMessage.findMany).mockResolvedValue([]);
	  vi.mocked(prisma.chatMessage.createMany).mockResolvedValue({ count: 1 });
	  vi.mocked(prisma.systemConfig.findUnique).mockResolvedValue(null);
	});

afterEach(() => {
  if (originalVllm === undefined) delete process.env.VLLM_BASE_URL;
  else process.env.VLLM_BASE_URL = originalVllm;
});

function lastPersistedRows() {
  const data = vi.mocked(prisma.chatMessage.createMany).mock.calls.at(-1)?.[0]?.data;
  return Array.isArray(data) ? data : data ? [data] : [];
}

describe("POST /api/chat — ADHD oversight persistence (#533)", () => {
  it("persists tool-step assistant messages with overseen final content (non-streaming)", async () => {
    mockStreamResult({ text: DRAFT });
    mockAuditResult();

    const res = await action(makeArgs(baseBody({ streaming: false })));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.content).toContain("**Top summary**");
    expect(body.content).toContain("**Next?**");

    expect(prisma.chatMessage.createMany).toHaveBeenCalled();
    const persisted = lastPersistedRows();
    expect(persisted).toHaveLength(2);
    expect(persisted[0]).toMatchObject({ messageId: "tool-step", role: "assistant" });
    expect(persisted[1]).toMatchObject({ messageId: "final-step", role: "assistant" });
    expect(JSON.stringify(persisted[1]?.content)).toContain("**Top summary**");
  });

  it("persists overseen content before streaming the reply", async () => {
    mockStreamResult({ text: DRAFT });
    mockAuditResult();

    const res = await action(makeArgs(baseBody({ streaming: true })));
    expect(res.status).toBe(200);

    expect(prisma.chatMessage.createMany).toHaveBeenCalled();
    const persisted = lastPersistedRows();
    expect(persisted).toHaveLength(2);
    expect(JSON.stringify(persisted[1]?.content)).toContain("**Next?**");
    expect(await res.text()).toContain("Want to continue?");
  });

  it("returns 500 when overseen persistence fails instead of showing unsaved text", async () => {
    mockStreamResult({ text: DRAFT });
    mockAuditResult();
    vi.mocked(prisma.chatMessage.createMany)
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(new Error("db down"));

    const res = await action(makeArgs(baseBody({ streaming: true })));
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBe("Failed to generate overseen response");
    expect(body.details).toContain("db down");
  });

  it("skips oversight when ADHD_ASSIST_OVERSIGHT is disabled", async () => {
    process.env.ADHD_ASSIST_OVERSIGHT = "false";
    mockStreamResult({ text: DRAFT });

    const res = await action(makeArgs(baseBody({ streaming: false })));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.content).toBe(DRAFT);
    expect(body.content).not.toContain("**Top summary**");
  });
});
