// @vitest-environment node
// #1113: route-level completion limits backed by the integration Redis service.
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/ai/completion.server", () => ({
  runCompletion: vi.fn(),
}));

vi.mock("~/lib/auth/guards.server", () => ({
  enforceAdminIfApiKey: vi.fn().mockResolvedValue({ response: null, session: null }),
  requireServiceKey: vi.fn().mockResolvedValue(null),
}));

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import { runCompletion } from "~/lib/ai/completion.server";
import { resetRateLimitsForTests, checkRateLimit } from "~/lib/auth/rate-limit.server";
import { enforceAdminIfApiKey, requireServiceKey } from "~/lib/auth/guards.server";
import { auth } from "~/lib/auth/server";
import { rateLimitRedis } from "~/lib/queue/connection.server";
import { action } from "~/routes/api/completion";

const keysToClean = new Set<string>();

function makeArgs() {
  return {
    request: new Request("http://localhost/api/completion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai:gpt-4o-mini",
        apiKeys: { openai: { apiKey: "integration-placeholder", isEnabled: true } },
        systemPrompt: "Return a short test response.",
        messages: [{ role: "user", content: "Hello" }],
        streaming: false,
      }),
    }),
    params: {},
    context: {} as never,
  } as never;
}

function mockCompletionSuccess() {
  vi.mocked(runCompletion).mockResolvedValue({
    ok: true,
    streaming: false,
    fleetServerId: null,
    body: { content: "stubbed; no provider contacted" },
  } as never);
}

async function expectThirdRequestLimited() {
  const first = await action(makeArgs());
  const second = await action(makeArgs());
  const denied = await action(makeArgs());

  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(denied.status).toBe(429);
  const body = await denied.json();
  expect(body).toEqual({
    error: "RATE_LIMITED",
    retryAfter: expect.any(Number),
  });
  expect(Number.isInteger(body.retryAfter)).toBe(true);
  expect(body.retryAfter).toBeGreaterThan(0);
  expect(denied.headers.get("Retry-After")).toBe(String(body.retryAfter));
  expect(runCompletion).toHaveBeenCalledTimes(2);
}

beforeEach(async () => {
  vi.clearAllMocks();
  resetRateLimitsForTests();
  vi.stubEnv("CHAT_RATE_LIMIT", "2");
  vi.stubEnv("CHAT_RATE_LIMIT_WINDOW_MS", "60000");
  vi.mocked(enforceAdminIfApiKey).mockResolvedValue({ response: null, session: null } as never);
  vi.mocked(requireServiceKey).mockResolvedValue(null);
  mockCompletionSuccess();
  for (const key of keysToClean) await rateLimitRedis.del(key);
  keysToClean.clear();
});

afterAll(async () => {
  for (const key of keysToClean) await rateLimitRedis.del(key);
  vi.unstubAllEnvs();
});

describe("POST /api/completion distributed rate limit (#1113)", () => {
  it("limits the shared service-key identity before a third provider call", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    keysToClean.add("completion:service");
    await rateLimitRedis.del("completion:service");

    await expectThirdRequestLimited();
  });

  it("limits a session-authenticated identity independently", async () => {
    const userId = `completion-integration-${randomUUID()}`;
    keysToClean.add(`completion:${userId}`);
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: userId, role: "STUDENT" },
    } as never);

    await expectThirdRequestLimited();
  });

  it("serializes the stable provider failure contract", async () => {
    const userId = `completion-provider-${randomUUID()}`;
    keysToClean.add(`completion:${userId}`);
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: userId, role: "STUDENT" },
    } as never);
    vi.mocked(runCompletion).mockResolvedValue({
      ok: false,
      status: 503,
      error: "Provider is temporarily unavailable",
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
      provider: "openai",
      retryAfter: 13,
    } as never);

    const response = await action(makeArgs());

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("13");
    expect(await response.json()).toEqual({
      error: "Provider is temporarily unavailable",
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
      provider: "openai",
    });
  });

  it("keeps Redis authoritative after process-local state is cleared", async () => {
    const key = `completion:redis-proof:${randomUUID()}`;
    keysToClean.add(key);

    await expect(checkRateLimit(key, 1, 60_000)).resolves.toEqual({
      limited: false,
      retryAfter: 0,
    });
    resetRateLimitsForTests();
    const secondDecision = await checkRateLimit(key, 1, 60_000);

    expect(secondDecision.limited).toBe(true);
    expect(Number.isInteger(secondDecision.retryAfter)).toBe(true);
    expect(secondDecision.retryAfter).toBeGreaterThan(0);
  });
});
