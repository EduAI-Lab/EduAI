// @vitest-environment node
// #1113 — a provider error raised after streaming has started must reach the
// client through the AI SDK stream error channel as the stable sanitized body,
// not the generic "An error occurred." fallback. This test drives the real
// streamText + toDataStreamResponse pipeline with a model whose stream emits
// text deltas first and then an error part, then consumes the response body.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const checkRateLimitMock = vi.hoisted(() => vi.fn());

vi.mock("~/lib/auth/rate-limit.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/auth/rate-limit.server")>();
  return { ...actual, checkRateLimit: checkRateLimitMock };
});

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/guards.server", () => ({
  enforceAdminIfApiKey: vi.fn().mockResolvedValue({ response: null, session: null }),
  requireServiceKey: vi.fn().mockResolvedValue(null),
}));

vi.mock("~/lib/ai/providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/ai/providers")>();
  return {
    ...actual,
    createAIProviderRegistry: vi.fn(),
    mergeLocalInferenceFromEnv: vi.fn((settings) => settings),
  };
});

vi.mock("~/lib/ai/routing/fleet/registry", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/lib/ai/routing/fleet/registry")>();
  return {
    ...actual,
    fleetRoutingEnabled: vi.fn().mockReturnValue(false),
  };
});

vi.mock("~/lib/ai/routing/fleet/resolve-fleet", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/lib/ai/routing/fleet/resolve-fleet")>();
  return {
    ...actual,
    resolveFleetHost: vi.fn(),
  };
});

import { APICallError } from "ai";
import { action } from "~/routes/api/completion";
import { auth } from "~/lib/auth/server";
import { createAIProviderRegistry } from "~/lib/ai/providers";
import { fleetRoutingEnabled } from "~/lib/ai/routing/fleet/registry";

function makeRequest(body: object) {
  return {
    request: new Request("http://localhost/api/completion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: {},
    context: {} as never,
  } as never;
}

function streamingBody() {
  return {
    model: "openai:gpt-4o",
    apiKeys: { openai: { isEnabled: true, apiKey: "sk-test-key" } },
    systemPrompt: "You are a helpful assistant.",
    messages: [{ role: "user", content: "Hello" }],
    streaming: true,
  };
}

// A minimal LanguageModelV1 whose doStream succeeds (so streamText returns a
// streaming result) but then emits text deltas followed by a provider error
// part once the stream is consumed — the late failure #1113 describes.
function makeFailingModel(upstreamError: unknown) {
  return {
    specificationVersion: "v1",
    provider: "openai",
    modelId: "gpt-4o",
    defaultObjectGenerationMode: "json",
    supportsImageUrls: false,
    supportsStructuredOutputs: false,
    supportsUrl: () => false,
    doGenerate: vi.fn().mockRejectedValue(new Error("doGenerate is not exercised")),
    doStream: vi.fn().mockResolvedValue({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "text-delta", textDelta: "Hello" });
          controller.enqueue({ type: "text-delta", textDelta: " world" });
          controller.enqueue({ type: "error", error: upstreamError });
          controller.close();
        },
      }),
      rawCall: { rawPrompt: "prompt", rawSettings: {} },
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CHAT_RATE_LIMIT", "2");
  vi.stubEnv("CHAT_RATE_LIMIT_WINDOW_MS", "60000");
  checkRateLimitMock.mockResolvedValue({ limited: false, retryAfter: 0 });
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "u1", role: "STUDENT" },
  } as never);
  vi.mocked(fleetRoutingEnabled).mockReturnValue(false);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/completion late stream provider errors (#1113)", () => {
  it("serializes a provider error raised mid-stream into the stream error channel", async () => {
    const upstreamError = new APICallError({
      message: "upstream 503 containing sk-do-not-leak",
      url: "https://provider.test/v1/chat",
      requestBodyValues: { apiKey: "sk-do-not-leak" },
      statusCode: 503,
      responseHeaders: { "retry-after": "12" },
      responseBody: "private upstream body",
      isRetryable: true,
    });
    vi.mocked(createAIProviderRegistry).mockReturnValue({
      languageModel: vi.fn().mockReturnValue(makeFailingModel(upstreamError)),
    } as never);

    const res = await action(makeRequest(streamingBody()));
    expect(res.status).toBe(200);

    const text = await res.text();

    // The stream started successfully: text deltas flowed before the failure.
    expect(text).toContain('0:"Hello"');

    // Data stream errors are emitted as `3:"<message>"` parts.
    const errorLine = text
      .trim()
      .split("\n")
      .find((line) => line.startsWith("3:"));
    expect(errorLine).toBeDefined();

    const serialized = JSON.parse(errorLine!.slice(2));
    expect(JSON.parse(serialized)).toEqual({
      error: "Provider is temporarily unavailable",
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
      provider: "openai",
    });

    expect(text).not.toContain("An error occurred.");
    expect(text).not.toContain("sk-do-not-leak");
    expect(text).not.toContain("private upstream body");
  });
});
