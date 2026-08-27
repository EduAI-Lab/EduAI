/**
 * #1647: the tutor's server-to-server call to Core's `/api/completion`
 * forwarded only Content-Type + the user cookie. Core's mutation guard
 * (`root.tsx`) rejects a cookie-bearing unsafe-method request that cannot prove
 * same-origin unless it presents the service key, so in a split-origin topology
 * the call was refused with CROSS_ORIGIN_MUTATION (403) before any model ran.
 * `callEduAI` must send `Authorization: Bearer <service key>` like the other
 * eduaiClient reads, while keeping the cookie for user identity.
 *
 * Cross-service key source (#1647 review): the Bearer must be the env
 * `EDUAI_API_KEY`, because that is the *only* value Core validates against —
 * `hasValidServiceKey` (`apps/core/app/lib/auth/service-key.server.ts`) compares
 * the token to Core's own `process.env.EDUAI_API_KEY` and has no access to this
 * service's DB. A DB-stored admin override therefore cannot authenticate to
 * Core; presenting it would 403. These tests drive `callEduAI` through the real
 * `serviceAuthHeader` path by controlling `process.env` (and prove a DB override
 * does NOT leak into the cross-service Bearer).
 *
 * Fetch is mocked in-process, so these tests never contact the real endpoint.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { findSystemSetting } = vi.hoisted(() => ({ findSystemSetting: vi.fn() }));

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    promptTemplate: {
      findUnique: vi.fn().mockResolvedValue({
        systemPrompt: "Be a helpful tutor.",
      }),
    },
    // A DB admin override lives here. `serviceAuthHeader` must NOT read it for
    // Core auth — these tests assert the env key wins regardless.
    systemSetting: {
      findUnique: findSystemSetting,
    },
  },
}));

vi.mock("../../src/services/eduaiClient.js", () => ({
  getEduAiCompletionUrl: () => "http://not-actually-called.test/api/completion",
}));

const originalFetch = global.fetch;
const originalServiceKey = process.env.EDUAI_API_KEY;

beforeEach(() => {
  // No DB-stored override unless a test opts in.
  findSystemSetting.mockResolvedValue(null);
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalServiceKey === undefined) {
    delete process.env.EDUAI_API_KEY;
  } else {
    process.env.EDUAI_API_KEY = originalServiceKey;
  }
  vi.restoreAllMocks();
});

function successfulResponse() {
  return {
    ok: true,
    json: () => Promise.resolve({ content: "Start by identifying the base case." }),
  };
}

async function generateResponse() {
  const { generateGuideResponse } = await import("../../src/services/aiGuidance.js");

  return generateGuideResponse({
    activity: {
      mainTopic: { name: "Recursion" },
      config: { question: "What is a recursive base case?", questionType: "SHORT_TEXT" },
    },
    knowledgeLevel: "beginner",
    message: "Can you give me a hint?",
    studentAnswer: null,
    dualLoopEnabled: false,
    cookie: "session=service-key-test",
    apiKey: "fake-test-key",
  });
}

describe("callEduAI cross-origin mutation guard (#1647)", () => {
  it("sends the env EDUAI_API_KEY as a Bearer", async () => {
    process.env.EDUAI_API_KEY = "svc-secret-123";
    global.fetch = vi.fn().mockResolvedValue(successfulResponse());

    await generateResponse();

    const [, requestInit] = global.fetch.mock.calls[0];
    expect(requestInit.headers.Authorization).toBe("Bearer svc-secret-123");
    // Cookie is still forwarded for user identity / rate-limiting.
    expect(requestInit.headers.cookie).toBe("session=service-key-test");
  });

  it("sends the env key Core validates even when a DB override is set — the override cannot authenticate to Core", async () => {
    // Core's guard only compares against its own env key, so a diverging DB
    // admin override must NEVER be the cross-service Bearer, or Core would 403.
    process.env.EDUAI_API_KEY = "core-env-key";
    findSystemSetting.mockResolvedValue({ key: "EDUAI_API_KEY", value: "different-db-override" });
    global.fetch = vi.fn().mockResolvedValue(successfulResponse());

    await generateResponse();

    const [, requestInit] = global.fetch.mock.calls[0];
    expect(requestInit.headers.Authorization).toBe("Bearer core-env-key");
    expect(requestInit.headers.Authorization).not.toContain("different-db-override");
    expect(requestInit.headers.cookie).toBe("session=service-key-test");
  });

  it("omits the Bearer (and logs a breadcrumb) when env is unset — a DB override alone cannot authenticate to Core", async () => {
    // Deploy keyed only via the DB admin setting, env unset. Core can't validate
    // that override, so sending it would 403 anyway; omit the header and leave a
    // traceable breadcrumb instead. The key is never logged.
    delete process.env.EDUAI_API_KEY;
    findSystemSetting.mockResolvedValue({ key: "EDUAI_API_KEY", value: "db-only-key" });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    global.fetch = vi.fn().mockResolvedValue(successfulResponse());

    await generateResponse();

    const [, requestInit] = global.fetch.mock.calls[0];
    expect(requestInit.headers.Authorization).toBeUndefined();
    expect(requestInit.headers.cookie).toBe("session=service-key-test");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("service_key_unset"),
      expect.anything(),
    );
  });

  it("omits the Authorization header and logs a breadcrumb when no key is configured", async () => {
    delete process.env.EDUAI_API_KEY;
    findSystemSetting.mockResolvedValue(null);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    global.fetch = vi.fn().mockResolvedValue(successfulResponse());

    await generateResponse();

    const [, requestInit] = global.fetch.mock.calls[0];
    expect(requestInit.headers.Authorization).toBeUndefined();
    expect(requestInit.headers.cookie).toBe("session=service-key-test");
    // A diagnostic breadcrumb is emitted so the split-origin 403 misconfig is
    // traceable; the key itself is never logged.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("service_key_unset"),
      expect.anything(),
    );
  });
});
