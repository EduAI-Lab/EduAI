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
  FleetUnavailableError,
  resolveFleetHost,
  resolveFleetHostAfterFailure,
} from "~/lib/ai/routing/fleet/resolve-fleet";
import { getAiAdmissionStats, resetAiAdmission } from "~/lib/ai/admission.server";
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

// Mirrors the real AI SDK's fullStream: a genuine ReadableStream (so
// `.getReader()` / `.cancel()` behave like production), not a bare async
// generator. onChunk fires as a side effect of the stream being read, same
// as the real SDK.
function makeFullStream(
  parts: unknown[],
  onChunk?: (chunk: unknown) => void,
): ReadableStream<unknown> {
  let cancelled = false;
  return new ReadableStream({
    async pull(controller) {
      if (cancelled) {
        controller.close();
        return;
      }
      const part = parts.shift();
      if (part === undefined) {
        controller.close();
        return;
      }
      onChunk?.({ chunk: part });
      controller.enqueue(part);
    },
    cancel() {
      cancelled = true;
    },
  });
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
    expect(body).toEqual({
      error: "Provider request failed",
      code: "PROVIDER_REQUEST_FAILED",
      retryable: false,
      provider: "vllm",
    });

    const logMessages = logSpy.mock.calls.map((c) => String(c[0]));
    expect(logMessages.some((m) => m.includes("retry attempt"))).toBe(true);
    expect(logMessages.some((m) => m.includes("fleetRetry: true"))).toBe(false);

    expect(streamText).toHaveBeenCalledTimes(2);
    expect(resolveFleetHostAfterFailure).toHaveBeenCalledTimes(1);

  });

  it("normalizes fleet model unavailability without leaking host details", async () => {
    vi.mocked(resolveFleetHost).mockRejectedValue(
      new FleetUnavailableError(
        "No healthy server at http://private-fleet.internal",
      ),
    );

    const res = await action(makeRequest(baseBody()));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({
      error: "Requested model is unavailable",
      code: "MODEL_UNAVAILABLE",
      retryable: true,
      provider: "vllm",
    });
    expect(JSON.stringify(body)).not.toContain("private-fleet");
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
        args.onStepFinish?.({ toolCalls: [], toolResults: [] } as never);
        return {
          get fullStream() {
            return makeFullStream(
              [{ type: "text-delta", text: "Recovered on cmps02." }],
              args.onChunk as never,
            );
          },
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

// Regression test for the fleet stream startup probe deadlock: onChunk/onStepFinish
// only fire once something reads the stream (as the real AI SDK behaves — see
// streamText's lazy fullStream getter), so runStreamText must start reading before
// or concurrently with awaiting the probe, not after. Previously nothing read the
// stream until after `await probe.wait()` returned, so the probe always fell through
// to its full timeout even on a healthy, fast-responding host.
describe("Fleet stream startup probe does not deadlock on a lazy stream", () => {
  it("resolves via onChunk instead of waiting out the full probe timeout", async () => {
    process.env.FLEET_STREAM_PROBE_MS = "5000";

    vi.mocked(streamText).mockImplementation((args) => {
      return {
        get fullStream() {
          return makeFullStream([{ type: "text-delta", text: "Hi" }], args.onChunk as never);
        },
        consumeStream: vi.fn().mockResolvedValue(undefined),
        text: Promise.resolve("Hi"),
        usage: Promise.resolve({ promptTokens: 5, completionTokens: 2 }),
        finishReason: Promise.resolve("stop"),
        sources: Promise.resolve([]),
        reasoning: Promise.resolve(undefined),
        response: Promise.resolve({
          id: "resp-1",
          messages: [{ id: "msg-1", role: "assistant", content: "Hi" }],
        }),
      } as never;
    });

    const t0 = Date.now();
    const res = await action(makeRequest(baseBody()));
    const elapsedMs = Date.now() - t0;

    expect(res.status).toBe(200);
    // A regression to the deadlock would take ~5000ms (the probe's soft-timeout);
    // the fix resolves as soon as onChunk fires during stream iteration.
    expect(elapsedMs).toBeLessThan(1_000);
  });

  it("stops reading fullStream once the probe is ready, on the streaming response path", async () => {
    process.env.FLEET_STREAM_PROBE_MS = "5000";
    process.env.AI_MAX_INFLIGHT = "1";

    let upstreamCancelled = false;
    vi.mocked(streamText).mockImplementation((args) => {
      const chunks = ["Hi", " there"];
      const upstream = new ReadableStream<{ type: string; text: string }>({
        pull(controller) {
          const text = chunks.shift();
          if (text === undefined) {
            // Keep the provider stream open until the client disconnects.
            return;
          }
          const part = { type: "text-delta", text };
          args.onChunk?.({ chunk: part } as never);
          controller.enqueue(part);
        },
        cancel() {
          upstreamCancelled = true;
        },
      });

      // Mirror the AI SDK: fullStream tees the shared provider stream, and
      // toDataStreamResponse consumes the sibling rather than a canned body.
      let responseBranch = upstream;
      return {
        get fullStream() {
          const [probeBranch, downstreamBranch] = responseBranch.tee();
          responseBranch = downstreamBranch;
          return probeBranch;
        },
        consumeStream: vi.fn().mockResolvedValue(undefined),
        toDataStreamResponse: vi.fn(({ headers }: { headers?: Record<string, string> }) => {
          const encoder = new TextEncoder();
          const encodedBody = responseBranch.pipeThrough(
            new TransformStream<{ type: string; text: string }, Uint8Array>({
              transform(part, controller) {
                controller.enqueue(encoder.encode(part.text));
              },
            }),
          );
          return new Response(encodedBody, { status: 200, headers });
        }),
        text: Promise.resolve("Hi there"),
        usage: Promise.resolve({ promptTokens: 5, completionTokens: 2 }),
        finishReason: Promise.resolve("stop"),
        sources: Promise.resolve([]),
        reasoning: Promise.resolve(undefined),
        response: Promise.resolve({
          id: "resp-1",
          messages: [{ id: "msg-1", role: "assistant", content: "Hi there" }],
        }),
      } as never;
    });

    const res = await action(makeRequest(baseBody({ streaming: true })));

    expect(res.status).toBe(200);
    expect(getAiAdmissionStats().inflight).toBe(1);

    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe("Hi");
    await reader.cancel();

    await vi.waitFor(() => {
      expect(upstreamCancelled).toBe(true);
      expect(getAiAdmissionStats().inflight).toBe(0);
    });
  });
});
