// @vitest-environment node
//
// #1803 — EduAI API keys silently inherited the better-auth api-key plugin's
// default rate limit (10 requests / 24h), and every verification failure —
// throttled, spent, expired, forged — collapsed into a bare 401 Unauthorized.
// An autograding script died on its 11th call of the day with nothing to
// retry against and no way to tell a transient denial from a revoked key.
//
// Two contracts are pinned here: the plugin is always handed an explicit
// rateLimit config, and `enforceAdminIfApiKey` distinguishes a throttled key
// from an invalid one.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// vi.mock factories are hoisted above module-level consts, so the doubles they
// close over have to be created in a hoisted block.
const { verifyApiKey, getRequestSession, isActiveAdminUser, logSecurityEvent } = vi.hoisted(() => ({
  verifyApiKey: vi.fn(),
  getRequestSession: vi.fn(),
  isActiveAdminUser: vi.fn(),
  logSecurityEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { verifyApiKey } },
}));

vi.mock("~/lib/auth/request-session.server", () => ({
  getRequestSession,
}));

vi.mock("~/lib/api-keys/access.server", () => ({
  isActiveAdminUser,
}));

vi.mock("~/lib/logging.server", () => ({
  logSecurityEvent,
  // Run the effect synchronously so assertions do not race the audit write.
  fireAndForget: (p: Promise<unknown>) => {
    void p;
  },
}));

vi.mock("~/lib/policy.server", () => ({
  getPolicy: vi.fn().mockResolvedValue(true),
  denyByPolicy: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({
  default: { user: { findUnique: vi.fn() } },
}));

import { enforceAdminIfApiKey } from "~/lib/auth/guards.server";
import {
  DEFAULT_API_KEY_RATE_LIMIT_MAX,
  DEFAULT_API_KEY_RATE_LIMIT_WINDOW_MS,
  getApiKeyRateLimitConfig,
} from "~/lib/api-keys/rate-limit";

function keyRequest() {
  return new Request("http://localhost/api/completion", {
    method: "POST",
    headers: { "x-api-key": "eduai_test_key" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getRequestSession.mockResolvedValue(null);
  isActiveAdminUser.mockResolvedValue(false);
});

describe("api key rate limit configuration", () => {
  const ENV_KEYS = [
    "API_KEY_RATE_LIMIT_ENABLED",
    "API_KEY_RATE_LIMIT_MAX",
    "API_KEY_RATE_LIMIT_WINDOW_MS",
  ] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("defaults far above the plugin's 10-per-day, and stays enabled", () => {
    const config = getApiKeyRateLimitConfig();
    expect(config.enabled).toBe(true);
    expect(config.maxRequests).toBe(DEFAULT_API_KEY_RATE_LIMIT_MAX);
    expect(config.timeWindow).toBe(DEFAULT_API_KEY_RATE_LIMIT_WINDOW_MS);
    // The regression itself: the plugin default that caused #1803.
    expect(config.maxRequests).toBeGreaterThan(10);
    // The pilot's acceptance criterion is 200 sequential calls in 24h.
    expect(config.maxRequests).toBeGreaterThanOrEqual(200);
  });

  it("reads overrides from the environment", () => {
    process.env.API_KEY_RATE_LIMIT_MAX = "50";
    process.env.API_KEY_RATE_LIMIT_WINDOW_MS = "60000";
    const config = getApiKeyRateLimitConfig();
    expect(config.maxRequests).toBe(50);
    expect(config.timeWindow).toBe(60_000);
  });

  it("only disables on an explicit 0", () => {
    process.env.API_KEY_RATE_LIMIT_ENABLED = "0";
    expect(getApiKeyRateLimitConfig().enabled).toBe(false);
    process.env.API_KEY_RATE_LIMIT_ENABLED = "false";
    expect(getApiKeyRateLimitConfig().enabled).toBe(true);
  });

  it("ignores values that would deny every request", () => {
    // A zero/negative/NaN ceiling would lock out every caller; fall back rather
    // than brick API-key auth on a typo. "0.5" floors to 0.
    for (const bad of ["0", "-5", "abc", "   ", "0.5"]) {
      process.env.API_KEY_RATE_LIMIT_MAX = bad;
      expect(getApiKeyRateLimitConfig().maxRequests).toBe(DEFAULT_API_KEY_RATE_LIMIT_MAX);
    }
  });
});

describe("enforceAdminIfApiKey — throttled keys are not credential failures", () => {
  it("answers 429 with Retry-After when the key is rate limited", async () => {
    verifyApiKey.mockResolvedValue({
      valid: false,
      key: null,
      error: { code: "RATE_LIMITED", details: { tryAgainIn: 90_000 } },
    });

    const { response, session } = await enforceAdminIfApiKey(keyRequest());

    expect(session).toBeNull();
    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toBe("90");
    expect(await response?.json()).toEqual({ error: "RATE_LIMITED", retryAfter: 90 });
  });

  it("answers 429 without Retry-After when the key's allowance is spent", async () => {
    // USAGE_EXCEEDED has no refill timer, so there is no honest retry hint.
    verifyApiKey.mockResolvedValue({
      valid: false,
      key: null,
      error: { code: "USAGE_EXCEEDED" },
    });

    const { response } = await enforceAdminIfApiKey(keyRequest());

    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toBeNull();
    expect(await response?.json()).toEqual({ error: "USAGE_EXCEEDED" });
  });

  it("audits a throttled key separately from a denied one", async () => {
    verifyApiKey.mockResolvedValue({
      valid: false,
      key: null,
      error: { code: "RATE_LIMITED", details: { tryAgainIn: 1000 } },
    });

    await enforceAdminIfApiKey(keyRequest());

    expect(logSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ actionCode: "API_KEY_RATE_LIMITED" }),
    );
    expect(logSecurityEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ actionCode: "API_KEY_DENIED" }),
    );
  });

  it("still answers 401 for a key that is simply invalid", async () => {
    verifyApiKey.mockResolvedValue({
      valid: false,
      key: null,
      error: { code: "KEY_NOT_FOUND" },
    });

    const { response } = await enforceAdminIfApiKey(keyRequest());

    expect(response?.status).toBe(401);
    expect(await response?.json()).toEqual({ error: "Unauthorized" });
    expect(logSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ actionCode: "API_KEY_DENIED" }),
    );
  });

  it("still answers 401 when the plugin reports no error code at all", async () => {
    verifyApiKey.mockResolvedValue({ valid: false, key: null, error: null });

    const { response } = await enforceAdminIfApiKey(keyRequest());

    expect(response?.status).toBe(401);
  });

  it("clamps an implausible retry window rather than emitting it", async () => {
    verifyApiKey.mockResolvedValue({
      valid: false,
      key: null,
      // 30 days, e.g. from a misconfigured window.
      error: { code: "RATE_LIMITED", details: { tryAgainIn: 30 * 24 * 60 * 60 * 1000 } },
    });

    const { response } = await enforceAdminIfApiKey(keyRequest());

    expect(response?.headers.get("Retry-After")).toBe(String(60 * 60 * 24));
  });

  it("ignores a non-numeric tryAgainIn instead of emitting a bad header", async () => {
    verifyApiKey.mockResolvedValue({
      valid: false,
      key: null,
      error: { code: "RATE_LIMITED", details: { tryAgainIn: "soon" } },
    });

    const { response } = await enforceAdminIfApiKey(keyRequest());

    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toBeNull();
  });

  it("leaves a request with no x-api-key header untouched", async () => {
    const { response, session } = await enforceAdminIfApiKey(
      new Request("http://localhost/api/completion", { method: "POST" }),
    );

    expect(response).toBeNull();
    expect(session).toBeNull();
    expect(verifyApiKey).not.toHaveBeenCalled();
  });
});
