// @vitest-environment node
//
// #1805 — there was no way to ask Core which models are live without an admin
// browser session, so an instructor writing a grading script had to guess a
// model id and read a 422 to learn they were wrong. `GET /api/models` answers
// that question with the same credentials `/api/completion` accepts.

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  enforceAdminIfApiKey,
  getRequestSession,
  requireServiceKey,
  findMany,
  checkRateLimit,
  getChatRateLimitConfig,
} = vi.hoisted(() => ({
  enforceAdminIfApiKey: vi.fn(),
  getRequestSession: vi.fn(),
  requireServiceKey: vi.fn(),
  findMany: vi.fn(),
  checkRateLimit: vi.fn(),
  getChatRateLimitConfig: vi.fn(),
}));

vi.mock("~/lib/auth/guards.server", () => ({
  enforceAdminIfApiKey,
  requireServiceKey,
}));

vi.mock("~/lib/auth/request-session.server", () => ({
  getRequestSession,
}));

vi.mock("~/lib/auth/rate-limit.server", () => ({
  checkRateLimit,
  getChatRateLimitConfig,
}));

vi.mock("~/lib/prisma.server", () => ({
  default: { aIModel: { findMany } },
}));

import { loader } from "~/routes/api/models";

const ROWS = [
  {
    modelId: "qwen3.5-2b-instruct",
    name: "Qwen 3.5 2B (vLLM)",
    supportsTools: false,
    supportsImages: false,
    maxTokens: 8192,
    provider: { name: "vllm" },
  },
  {
    modelId: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    supportsTools: true,
    supportsImages: true,
    maxTokens: 1048576,
    provider: { name: "google" },
  },
];

function makeArgs() {
  return {
    request: new Request("http://localhost/api/models", { method: "GET" }),
    params: {},
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  enforceAdminIfApiKey.mockResolvedValue({ response: null, session: null });
  getRequestSession.mockResolvedValue(null);
  requireServiceKey.mockResolvedValue(null);
  findMany.mockResolvedValue(ROWS);
  getChatRateLimitConfig.mockReturnValue({ limit: 100, windowMs: 60_000 });
  checkRateLimit.mockResolvedValue({ limited: false, retryAfter: 0 });
});

describe("GET /api/models", () => {
  it("returns provider-qualified ids in the form callers pass as `model`", async () => {
    getRequestSession.mockResolvedValue({ user: { id: "u1", role: "STUDENT" } });

    const response = await loader(makeArgs());
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.models.map((m: { id: string }) => m.id)).toEqual([
      "vllm:qwen3.5-2b-instruct",
      "google:gemini-2.5-flash",
    ]);
    expect(body.models[0]).toEqual({
      id: "vllm:qwen3.5-2b-instruct",
      provider: "vllm",
      name: "Qwen 3.5 2B (vLLM)",
      supportsTools: false,
      supportsImages: false,
      maxTokens: 8192,
      requiresApiKey: false,
    });
    // Google requires a key; vLLM does not — the flag must come from the
    // provider, not be a blanket true/false.
    expect(body.models[1].requiresApiKey).toBe(true);
  });

  it("excludes a model whose provider name is not one /api/chat can parse", async () => {
    getRequestSession.mockResolvedValue({ user: { id: "u1", role: "STUDENT" } });
    findMany.mockResolvedValue([
      ...ROWS,
      {
        modelId: "claude-x",
        name: "Renamed row",
        supportsTools: false,
        supportsImages: false,
        maxTokens: 4096,
        // Not a key of PROVIDER_CONFIGS — e.g. an admin-renamed provider row.
        provider: { name: "anthropic" },
      },
    ]);

    const response = await loader(makeArgs());
    const body = await response.json();

    expect(body.models.map((m: { id: string }) => m.id)).toEqual([
      "vllm:qwen3.5-2b-instruct",
      "google:gemini-2.5-flash",
    ]);
  });

  it("rate-limits under the shared chat limiter", async () => {
    getRequestSession.mockResolvedValue({ user: { id: "u1", role: "STUDENT" } });
    checkRateLimit.mockResolvedValue({ limited: true, retryAfter: 12 });

    const response = await loader(makeArgs());

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("12");
    expect(findMany).not.toHaveBeenCalled();
    expect(checkRateLimit).toHaveBeenCalledWith("models:u1", 100, 60_000);
  });

  it("only lists models the completion endpoint would also accept", async () => {
    getRequestSession.mockResolvedValue({ user: { id: "u1", role: "STUDENT" } });

    await loader(makeArgs());

    // Advertising a model that /api/completion then rejects with 422 is the
    // exact confusion this endpoint exists to remove, so the activeness
    // predicate must match resolveActiveChatModel's.
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { provider: { isActive: true }, type: "CHAT", isActive: true },
      }),
    );
  });

  it("is not cached — an admin edit must not be masked by a stale response", async () => {
    getRequestSession.mockResolvedValue({ user: { id: "u1", role: "STUDENT" } });

    const response = await loader(makeArgs());
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("accepts an admin x-api-key session without consulting cookies", async () => {
    enforceAdminIfApiKey.mockResolvedValue({
      response: null,
      session: { user: { id: "admin-1", role: "ADMIN" } },
    });

    const response = await loader(makeArgs());

    expect(response.status).toBe(200);
    expect(getRequestSession).not.toHaveBeenCalled();
    expect(requireServiceKey).not.toHaveBeenCalled();
  });

  it("falls back to the service key when there is no session", async () => {
    const response = await loader(makeArgs());

    expect(requireServiceKey).toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it("propagates the api-key guard's refusal verbatim", async () => {
    // Includes the 429 a throttled key now gets (#1803) — this route must not
    // flatten it back into its own error.
    enforceAdminIfApiKey.mockResolvedValue({
      response: new Response(JSON.stringify({ error: "RATE_LIMITED" }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "30" },
      }),
      session: null,
    });

    const response = await loader(makeArgs());

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(findMany).not.toHaveBeenCalled();
  });

  it("refuses an anonymous caller with no service key", async () => {
    requireServiceKey.mockResolvedValue(
      new Response(JSON.stringify({ error: "MISSING_SERVICE_KEY" }), { status: 401 }),
    );

    const response = await loader(makeArgs());

    expect(response.status).toBe(401);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("returns an empty list rather than failing when no model is active", async () => {
    getRequestSession.mockResolvedValue({ user: { id: "u1", role: "STUDENT" } });
    findMany.mockResolvedValue([]);

    const response = await loader(makeArgs());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ models: [] });
  });
});
