// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: vi.fn(),
    createDataStreamResponse: vi.fn(),
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

vi.mock("~/lib/auth/guards.server", () => ({
  enforceAdminIfApiKey: vi.fn().mockResolvedValue({ response: null, session: null }),
}));

vi.mock("~/lib/auth/course-access.server", () => ({
  resolveCourseAccessWithCourse: vi.fn().mockResolvedValue({
    course: { id: "c1", isPublished: true },
    access: { level: "student", rank: 0 },
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

// Explicit mock (rather than relying on the real impl's internal try/catch)
// so "not called" assertions below are a clean signal, not a swallowed throw.
vi.mock("~/lib/ai/routing/telemetry.server", () => ({
  persistAiInteractionTelemetry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    chat: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    chatMessage: { findMany: vi.fn(), createMany: vi.fn() },
    course: { findFirst: vi.fn() },
    systemConfig: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock("~/lib/user-provider-settings.server", () => ({
  getUserProviderSettings: vi.fn().mockResolvedValue({}),
}));

import { streamText } from "ai";
import { action } from "~/routes/api/chat";
import { auth } from "~/lib/auth/server";
import { auditAndMaybeRewrite } from "~/lib/ai/adhd-oversight";
import { withStructuralPass, computeAdhdResponseMetrics } from "~/lib/ai/adhd-metrics";
import { recordResponseComplianceEvent } from "~/lib/assistive-events.server";
import { persistAiInteractionTelemetry } from "~/lib/ai/routing/telemetry.server";
import { invalidatePolicyCache } from "~/lib/policy.server";
import { resetRateLimitsForTests } from "~/lib/auth/rate-limit.server";
import prisma from "~/lib/prisma.server";

const CHAT_ID = "cjld2cjxh0000qzrmn831i7rn";
const USER_ID = "user-1";
const BASELINE_DRAFT = "A long baseline paragraph answer with no structural anchors.";
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
  } as any;
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

function mockStreamResult(text: string) {
  vi.mocked(streamText).mockResolvedValue({
    consumeStream: vi.fn().mockResolvedValue(undefined),
    text: Promise.resolve(text),
    usage: Promise.resolve({ promptTokens: 5, completionTokens: 10 }),
    finishReason: Promise.resolve("stop"),
    sources: Promise.resolve([]),
    reasoning: Promise.resolve(undefined),
    response: Promise.resolve({
      id: "resp-1",
      messages: [{ id: "final-step", role: "assistant", content: text }],
    }),
  } as never);
}

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    messages: [{ id: "user-1", role: "user", content: "Explain tax brackets" }],
    model: "vllm:test-model",
    apiKeys: {},
    chatId: CHAT_ID,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimitsForTests();
  process.env.VLLM_BASE_URL = "http://localhost:8001";
  process.env.ADHD_ASSIST_OVERSIGHT = "true";
  invalidatePolicyCache();

  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: USER_ID, role: "STUDENT" },
  } as never);

  // Chat's stored default is baseline (false) — regenerateOnly requests below
  // ask for adhdAssist: true as a one-off override, which must never persist.
  vi.mocked(prisma.chat.findFirst).mockResolvedValue({
    id: CHAT_ID,
    userId: USER_ID,
    courseId: "c1",
    adhdAssist: false,
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

describe("POST /api/chat — regenerateOnly content preview (#1246)", () => {
  it("requires an existing chatId", async () => {
    const res = await action(
      makeArgs(baseBody({ chatId: undefined, regenerateOnly: true, adhdAssist: true })),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("chatId");
    expect(streamText).not.toHaveBeenCalled();
  });

  it("returns the ADHD-adapted content without persisting anything or flipping the chat's stored default", async () => {
    mockStreamResult(BASELINE_DRAFT);
    mockAuditResult();

    const res = await action(
      makeArgs(baseBody({ regenerateOnly: true, adhdAssist: true, streaming: true })),
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.content).toContain("**Top summary**");
    expect(body.content).toContain("**Next?**");

    // The whole point of regenerateOnly: a one-off preview, not a write.
    expect(prisma.chat.update).not.toHaveBeenCalled();
    expect(prisma.chatMessage.createMany).not.toHaveBeenCalled();
    expect(persistAiInteractionTelemetry).not.toHaveBeenCalled();
    expect(recordResponseComplianceEvent).not.toHaveBeenCalled();
  });

  it("returns 410 and generates nothing when the chatId is not owned by the acting user", async () => {
    vi.mocked(prisma.chat.findFirst).mockResolvedValue(null);

    const res = await action(
      makeArgs(
        baseBody({ chatId: "someone-elses-chat-id", regenerateOnly: true, adhdAssist: true }),
      ),
    );
    expect(res.status).toBe(410);

    const body = await res.json();
    expect(body.chatDeleted).toBe(true);
    expect(streamText).not.toHaveBeenCalled();
  });

  it("returns the baseline content when previewing Assist off, ignoring the streaming flag", async () => {
    mockStreamResult(BASELINE_DRAFT);

    const res = await action(
      makeArgs(
        baseBody({ regenerateOnly: true, adhdAssist: false, streaming: true }),
      ),
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.content).toBe(BASELINE_DRAFT);
    expect(auditAndMaybeRewrite).not.toHaveBeenCalled();
    expect(prisma.chat.update).not.toHaveBeenCalled();
    expect(prisma.chatMessage.createMany).not.toHaveBeenCalled();
  });

  it("a normal (non-regenerateOnly) turn still persists and updates the chat's adhdAssist default", async () => {
    mockStreamResult(BASELINE_DRAFT);
    mockAuditResult();
    vi.mocked(prisma.chat.update).mockResolvedValue({
      id: CHAT_ID,
      userId: USER_ID,
      courseId: "c1",
      adhdAssist: true,
      systemPrompt: null,
    } as never);

    const res = await action(makeArgs(baseBody({ adhdAssist: true, streaming: false })));
    expect(res.status).toBe(200);

    expect(prisma.chat.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { adhdAssist: true } }),
    );
    expect(prisma.chatMessage.createMany).toHaveBeenCalled();
  });
});
