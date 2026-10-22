// @vitest-environment node
// /api/completion for keys of users an admin granted API access (#2039).
import type { JsonObject } from "~/lib/json-value";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("~/lib/ai/providers.server", () => ({
  resolveActiveChatModel: vi.fn(),
}));

vi.mock("~/lib/ai/admission.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/ai/admission.server")>();
  return {
    ...actual,
    acquireAiAdmission: vi.fn().mockResolvedValue({ release: vi.fn(), waitedMs: 0 }),
    withAdmissionRelease: vi.fn((response: Response) => response),
  };
});

vi.mock("~/lib/ai/routing/fleet/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/ai/routing/fleet/registry")>();
  return {
    ...actual,
    fleetRoutingEnabled: vi.fn().mockReturnValue(false),
  };
});

vi.mock("~/lib/ai/routing/fleet/resolve-fleet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/ai/routing/fleet/resolve-fleet")>();
  return {
    ...actual,
    resolveFleetHost: vi.fn(),
  };
});

vi.mock("~/lib/api-keys/access-grants.server", () => ({
  checkApiAccessLimits: vi.fn(),
}));

vi.mock("~/lib/api-keys/request-log.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/api-keys/request-log.server")>();
  return { ...actual, startApiRequestLog: vi.fn() };
});

vi.mock("~/lib/user-provider-settings.server", () => ({
  getUserProviderSettings: vi.fn().mockResolvedValue({}),
}));

import { streamText } from "ai";
import { action } from "~/routes/api/completion";
import { auth } from "~/lib/auth/server";
import { createAIProviderRegistry } from "~/lib/ai/providers";
import { fleetRoutingEnabled } from "~/lib/ai/routing/fleet/registry";
import { resolveActiveChatModel } from "~/lib/ai/providers.server";
import { acquireAiAdmission, AdmissionTimeoutError } from "~/lib/ai/admission.server";
import { checkApiAccessLimits } from "~/lib/api-keys/access-grants.server";
import { getGrantedKeyInflight, resetGrantedKeySlots } from "~/lib/api-keys/granted-slots.server";
import { startApiRequestLog } from "~/lib/api-keys/request-log.server";
import { enforceAdminIfApiKey } from "~/lib/auth/guards.server";
import { getUserProviderSettings } from "~/lib/user-provider-settings.server";
import type { RouteRequestBody } from "../helpers/route-fixtures";

function makeRequest(body: RouteRequestBody, signal?: AbortSignal): Parameters<typeof action>[0] {
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

function baseBody(overrides: JsonObject = {}) {
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

const logger = {
  begin: vi.fn(),
  setModel: vi.fn(),
  setUsage: vi.fn(),
  finish: vi.fn(),
  finishWhenSettled: vi.fn(),
  finished: false,
};

const grant = {
  id: "g1",
  userId: "s1",
  expiresAt: new Date("2026-12-31"),
  dailyRequestLimit: 200,
  dailyTokenLimit: 200_000,
};

function asKeyCaller(role: "STUDENT" | "ADMIN", withGrant: boolean) {
  vi.mocked(enforceAdminIfApiKey).mockResolvedValue({
    response: null,
    session: { user: { id: role === "ADMIN" ? "a1" : "s1", role } } as never,
    apiKey: { id: "k1", grant: withGrant ? grant : null },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUserProviderSettings).mockResolvedValue({});
  process.env.VLLM_BASE_URL = "http://localhost:8001";
  vi.mocked(fleetRoutingEnabled).mockReturnValue(false);
  vi.mocked(resolveActiveChatModel).mockResolvedValue({
    name: "Test model",
    supportsTools: false,
    supportsImages: false,
    maxTokens: 16_384,
  });
  vi.mocked(acquireAiAdmission).mockResolvedValue({ release: vi.fn(), waitedMs: 0 });

  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "user-1", role: "STUDENT" },
  } as never);

  resetGrantedKeySlots();
  vi.mocked(startApiRequestLog).mockReturnValue(logger as never);
  logger.begin.mockResolvedValue(true);
  vi.mocked(checkApiAccessLimits).mockResolvedValue({
    ok: true,
    usage: { requests: 0, tokens: 0 },
  });
  vi.mocked(enforceAdminIfApiKey).mockResolvedValue({ response: null, session: null });

  vi.mocked(createAIProviderRegistry).mockReturnValue({
    languageModel: vi.fn().mockReturnValue({ provider: "vllm", modelId: "test-model" }),
  } as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/completion with API access grants (#2039)", () => {
  it("asks the guard to accept granted users' keys", async () => {
    mockStream();
    await action(makeRequest(baseBody()));
    expect(enforceAdminIfApiKey).toHaveBeenCalledWith(expect.any(Request), {
      allowGrantedUsers: true,
    });
  });

  it("serves a granted student on a campus model and logs the request with its usage", async () => {
    asKeyCaller("STUDENT", true);
    mockStream();
    const release = vi.fn();
    vi.mocked(acquireAiAdmission).mockResolvedValue({ release, waitedMs: 0 });

    const res = await action(makeRequest(baseBody()));

    expect(res.status).toBe(200);
    expect(startApiRequestLog).toHaveBeenCalledWith(
      { userId: "s1", apiKeyId: "k1", grantId: "g1" },
      "/api/completion",
    );
    expect(logger.setModel).toHaveBeenCalledWith("vllm:test-model");
    expect(logger.setUsage).toHaveBeenCalledWith(
      expect.objectContaining({ promptTokens: 1, completionTokens: 2 }),
    );
    expect(logger.finish).toHaveBeenCalledWith(200);
    expect(checkApiAccessLimits).toHaveBeenCalledWith(grant);
    expect(release).toHaveBeenCalledTimes(1);
    expect(getGrantedKeyInflight()).toBe(0);
  });

  it("refuses a granted student a non-campus model before using any slot", async () => {
    asKeyCaller("STUDENT", true);
    const res = await action(
      makeRequest(baseBody({ model: "google:gemini-2.0-flash", apiKeys: {} })),
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "API_ACCESS_MODEL_NOT_ALLOWED" });
    expect(acquireAiAdmission).not.toHaveBeenCalled();
    expect(logger.finish).toHaveBeenCalledWith(403);
  });

  it("answers 429 with the limit hit and a Retry-After once the daily allowance is used", async () => {
    asKeyCaller("STUDENT", true);
    vi.mocked(checkApiAccessLimits).mockResolvedValue({
      ok: false,
      limit: "tokens",
      usage: { requests: 12, tokens: 200_500 },
      retryAfter: 3600,
    });
    const res = await action(makeRequest(baseBody()));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("3600");
    await expect(res.json()).resolves.toEqual({
      error: "API_ACCESS_LIMIT",
      limit: "tokens",
      retryAfter: 3600,
    });
    expect(acquireAiAdmission).not.toHaveBeenCalled();
    expect(streamText).not.toHaveBeenCalled();
  });

  it("answers 503 API_ACCESS_BUSY when the granted-key slots are all taken", async () => {
    vi.stubEnv("API_ACCESS_MAX_INFLIGHT", "0");
    asKeyCaller("STUDENT", true);
    const res = await action(makeRequest(baseBody()));
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    await expect(res.json()).resolves.toMatchObject({ error: "API_ACCESS_BUSY" });
    expect(acquireAiAdmission).not.toHaveBeenCalled();
  });

  it("frees the granted-key slot when the admission gate times out", async () => {
    asKeyCaller("STUDENT", true);
    vi.mocked(acquireAiAdmission).mockRejectedValue(new AdmissionTimeoutError());
    const res = await action(makeRequest(baseBody()));
    expect(res.status).toBe(503);
    expect(getGrantedKeyInflight()).toBe(0);
  });

  it("logs an admin's key without applying grant limits", async () => {
    asKeyCaller("ADMIN", false);
    mockStream();
    const res = await action(
      makeRequest(baseBody({ model: "google:gemini-2.0-flash", apiKeys: {} })),
    );
    expect(checkApiAccessLimits).not.toHaveBeenCalled();
    expect(startApiRequestLog).toHaveBeenCalledWith(
      { userId: "a1", apiKeyId: "k1", grantId: null },
      "/api/completion",
    );
    expect(logger.finish).toHaveBeenCalledWith(res.status);
  });

  // #2040 review: a request is recorded, charged an estimate, before it can
  // reach a model, so aborted streams can't slip past the limits.
  it("records a granted request with its token estimate before taking an AI slot", async () => {
    asKeyCaller("STUDENT", true);
    mockStream();
    await action(
      makeRequest(
        baseBody({
          systemPrompt: "x".repeat(400),
          messages: [{ role: "user", content: "y".repeat(400) }],
          maxTokens: 1_000,
        }),
      ),
    );
    const [estimate] = logger.begin.mock.calls[0] as [number];
    // About 800 prompt characters (~200 tokens) plus every allowed output token.
    expect(estimate).toBeGreaterThan(1_200);
    expect(estimate).toBeLessThan(1_300);
    expect(logger.begin.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(acquireAiAdmission).mock.invocationCallOrder[0],
    );
  });

  it("charges the default output budget when maxTokens is not given", async () => {
    asKeyCaller("STUDENT", true);
    mockStream();
    await action(makeRequest(baseBody()));
    expect(logger.begin.mock.calls[0][0]).toBeGreaterThanOrEqual(8_192);
  });

  it("refuses a granted request it could not record, and frees its slot", async () => {
    asKeyCaller("STUDENT", true);
    logger.begin.mockResolvedValue(false);
    const res = await action(makeRequest(baseBody()));
    expect(res.status).toBe(503);
    expect(acquireAiAdmission).not.toHaveBeenCalled();
    expect(streamText).not.toHaveBeenCalled();
    expect(getGrantedKeyInflight()).toBe(0);
  });

  it("still serves an admin's key when its row could not be recorded", async () => {
    asKeyCaller("ADMIN", false);
    logger.begin.mockResolvedValue(false);
    mockStream();
    const res = await action(makeRequest(baseBody()));
    expect(res.status).toBe(200);
  });

  it("does not log cookie-session requests", async () => {
    mockStream();
    const res = await action(makeRequest(baseBody()));
    expect(res.status).toBe(200);
    expect(startApiRequestLog).not.toHaveBeenCalled();
  });
});
