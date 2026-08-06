// @vitest-environment node
// /api/completion abortSignal + provider-setup error coverage (#858 review).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: vi.fn(),
  };
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

import { streamText } from "ai";
import { action } from "~/routes/api/completion";
import { auth } from "~/lib/auth/server";
import { createAIProviderRegistry } from "~/lib/ai/providers";
import { fleetRoutingEnabled } from "~/lib/ai/routing/fleet/registry";
import { resolveFleetHost } from "~/lib/ai/routing/fleet/resolve-fleet";

function makeRequest(
  body: object,
  signal?: AbortSignal,
): Parameters<typeof action>[0] {
  return {
    request: new Request("http://localhost/api/completion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    }),
    url: new URL("http://localhost/api/completion"),
    pattern: "/api/completion",
    params: {},
    context: {} as never,
  } as Parameters<typeof action>[0];
}

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    model: "vllm:test-model",
    apiKeys: { vllm: { isEnabled: true, baseUrl: "http://localhost:8001" } },
    systemPrompt: "You are a helpful assistant.",
    messages: [{ role: "user", content: "Hello" }],
    streaming: false,
    ...overrides,
  };
}

function mockStream() {
  vi.mocked(streamText).mockResolvedValue({
    consumeStream: vi.fn().mockResolvedValue(undefined),
    text: Promise.resolve("Done."),
    usage: Promise.resolve({ promptTokens: 1, completionTokens: 2 }),
    finishReason: Promise.resolve("stop"),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.VLLM_BASE_URL = "http://localhost:8001";
  vi.mocked(fleetRoutingEnabled).mockReturnValue(false);

  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "user-1", role: "STUDENT" },
  } as never);

  vi.mocked(createAIProviderRegistry).mockReturnValue({
    languageModel: vi.fn().mockReturnValue({ provider: "vllm", modelId: "test-model" }),
  } as never);
});

describe("POST /api/completion review regressions", () => {
  it("passes the request AbortSignal to streamText as abortSignal", async () => {
    const controller = new AbortController();
    const args = makeRequest(baseBody(), controller.signal);
    mockStream();

    const res = await action(args);
    expect(res.status).toBe(200);

    expect(vi.mocked(streamText).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        abortSignal: args.request.signal,
      }),
    );

    await expect(res.json()).resolves.toEqual({
      content: "Done.",
      model: "vllm:test-model",
      usage: { promptTokens: 1, completionTokens: 2 },
      finishReason: "stop",
    });
  });

  it("returns JSON 502 when languageModel() throws before streamText", async () => {
    const setupError = new Error("AI_NoSuchProviderError: No such provider: vllm");
    setupError.name = "AI_NoSuchProviderError";

    vi.mocked(createAIProviderRegistry).mockReturnValue({
      languageModel: vi.fn().mockImplementation(() => {
        throw setupError;
      }),
    } as never);

    const res = await action(makeRequest(baseBody()));
    expect(res.status).toBe(502);

    const body = await res.json();
    expect(body).toEqual({
      error: expect.stringContaining("LLM provider setup failed"),
    });
    expect(body.error).toContain("AI_NoSuchProviderError");
    expect(streamText).not.toHaveBeenCalled();
  });

  it("returns the selected fleet host for extension observability", async () => {
    vi.mocked(fleetRoutingEnabled).mockReturnValue(true);
    vi.mocked(resolveFleetHost).mockResolvedValue({
      serverId: "cmps03",
      baseUrl: "http://cmps03.ok.ubc.ca:8001",
      reason: "background-round-robin",
    });
    mockStream();

    const res = await action(
      makeRequest(
        baseBody({
          routingContext: {
            feature: "question-maker",
            jobType: "background",
          },
        }),
      ),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Fleet-Server")).toBe("cmps03");
  });
});
