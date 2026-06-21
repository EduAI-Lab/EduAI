// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: vi.fn(() => ({
      // The route returns result.toDataStreamResponse({ headers }) for the
      // streaming, non-oversight path — echo the headers so we can assert them.
      toDataStreamResponse: ({ headers }: { headers: Record<string, string> }) =>
        new Response("ok", { status: 200, headers }),
    })),
    tool: vi.fn((definition: unknown) => definition),
  };
});

vi.mock("~/lib/auth/server", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("~/lib/auth/guards.server", () => ({
  enforceAdminIfApiKey: vi.fn().mockResolvedValue({ response: null, session: null }),
}));
vi.mock("~/lib/auth/course-access.server", () => ({
  resolveCourseAccessWithCourse: vi.fn(),
}));
vi.mock("~/lib/ai/providers.server", () => ({
  modelSupportsTools: vi.fn().mockResolvedValue(false),
}));
vi.mock("~/lib/assistive-events.server", () => ({
  recordResponseComplianceEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/lib/policy.server", () => ({ getPolicy: vi.fn() }));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    chat: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    chatMessage: { findMany: vi.fn(), createMany: vi.fn() },
    course: { findFirst: vi.fn() },
  },
}));

import { action } from "~/routes/api/chat";
import { auth } from "~/lib/auth/server";
import { resolveCourseAccessWithCourse } from "~/lib/auth/course-access.server";
import { getPolicy } from "~/lib/policy.server";
import prisma from "~/lib/prisma.server";

const CHAT_ID = "cjld2cjxh0000qzrmn831i7rn";
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

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    messages: [{ id: "u-1", role: "user", content: "hi" }],
    model: "vllm:test-model",
    apiKeys: {},
    streaming: true,
    chatId: CHAT_ID,
    ...overrides,
  };
}

/** getPolicy returns the per-key value set for this test. */
function policy(values: Record<string, boolean>) {
  vi.mocked(getPolicy).mockImplementation(async (key: string) => values[key] ?? false);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.VLLM_BASE_URL = "http://localhost:8001";
  vi.mocked(prisma.chatMessage.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.chatMessage.createMany).mockResolvedValue({ count: 1 } as never);
  // Default: general (non-course) chat owned by the caller.
  vi.mocked(prisma.chat.findFirst).mockResolvedValue({
    id: CHAT_ID, userId: "u1", adhdAssist: false, systemPrompt: null,
  } as never);
  // Course-context backfill (tagging an existing chat with its course) calls
  // chat.update; echo the patched row so the chat stays resolved on that path.
  vi.mocked(prisma.chat.update).mockImplementation(
    (async (args: { data?: Record<string, unknown> }) =>
      ({ id: CHAT_ID, userId: "u1", adhdAssist: false, systemPrompt: null, ...(args.data ?? {}) })) as never,
  );
});

afterEach(() => {
  if (originalVllm === undefined) delete process.env.VLLM_BASE_URL;
  else process.env.VLLM_BASE_URL = originalVllm;
});

function webHeader(res: Response) {
  return res.headers.get("X-Web-Tools-Enabled");
}

describe("chat.webToolsEnabled master switch", () => {
  it("web tools absent for an instructor when the master is off", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "INSTRUCTOR" } } as never);
    // #657: chat is course-scoped — give the instructor a course context.
    vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
      course: { id: "c1", isPublished: true } as never,
      access: { level: "instructor", rank: 2 } as never,
    });
    policy({ "chat.webToolsEnabled": false });
    const res = await action(makeArgs(baseBody({ courseId: "c1" })));
    expect(res.status).toBe(200);
    expect(webHeader(res)).toBe("0");
  });

  it("web tools present for a non-student when the master is on", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "INSTRUCTOR" } } as never);
    vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
      course: { id: "c1", isPublished: true } as never,
      access: { level: "instructor", rank: 2 } as never,
    });
    policy({ "chat.webToolsEnabled": true });
    const res = await action(makeArgs(baseBody({ courseId: "c1" })));
    expect(res.status).toBe(200);
    expect(webHeader(res)).toBe("1");
  });

  it("web tools absent for a student when the master is off", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "s1", role: "STUDENT" } } as never);
    vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
      course: { id: "c1", isPublished: true } as never,
      access: { level: "student", rank: 0 } as never,
    });
    vi.mocked(prisma.chat.findFirst).mockResolvedValue({
      id: CHAT_ID, userId: "s1", adhdAssist: false, systemPrompt: null,
    } as never);
    policy({ "chat.webToolsEnabled": false });
    const res = await action(makeArgs(baseBody({ courseId: "c1" })));
    expect(res.status).toBe(200);
    expect(webHeader(res)).toBe("0");
  });

  it("web tools present for a student when the master is on (students follow the master)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "s1", role: "STUDENT" } } as never);
    vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
      course: { id: "c1", isPublished: true } as never,
      access: { level: "student", rank: 0 } as never,
    });
    vi.mocked(prisma.chat.findFirst).mockResolvedValue({
      id: CHAT_ID, userId: "s1", adhdAssist: false, systemPrompt: null,
    } as never);
    policy({ "chat.webToolsEnabled": true });
    const res = await action(makeArgs(baseBody({ courseId: "c1" })));
    expect(res.status).toBe(200);
    expect(webHeader(res)).toBe("1");
  });
});
