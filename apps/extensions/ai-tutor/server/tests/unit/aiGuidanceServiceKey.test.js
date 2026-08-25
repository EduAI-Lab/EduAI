/**
 * #1647: the tutor's server-to-server call to Core's `/api/completion`
 * forwarded only Content-Type + the user cookie. Core's mutation guard
 * (`root.tsx`) rejects a cookie-bearing unsafe-method request that cannot prove
 * same-origin unless it presents the service key, so in a split-origin topology
 * the call was refused with CROSS_ORIGIN_MUTATION (403) before any model ran.
 * `callEduAI` must send `Authorization: Bearer <effective service key>` like the
 * other eduaiClient reads, while keeping the cookie for user identity.
 *
 * Provenance (adversarial-review follow-up): the key must be the *effective*
 * one — `getEffectiveEduAiApiKey`, which prefers the DB-stored (encrypted)
 * admin override and falls back to env. A deploy keyed via the DB setting with
 * env unset previously omitted the Bearer entirely and 403'd. These tests drive
 * `callEduAI` through the real `serviceAuthHeader`/`getEffectiveEduAiApiKey`
 * path by controlling the mocked `systemSetting` row + `process.env`.
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
    // `getEffectiveEduAiApiKey` reads the admin override from here; default is
    // "no override" so tests fall through to `process.env.EDUAI_API_KEY`.
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
  it("sends the env EDUAI_API_KEY as a Bearer when no DB override is set", async () => {
    process.env.EDUAI_API_KEY = "svc-secret-123";
    global.fetch = vi.fn().mockResolvedValue(successfulResponse());

    await generateResponse();

    const [, requestInit] = global.fetch.mock.calls[0];
    expect(requestInit.headers.Authorization).toBe("Bearer svc-secret-123");
    // Cookie is still forwarded for user identity / rate-limiting.
    expect(requestInit.headers.cookie).toBe("session=service-key-test");
  });

  it("prefers the DB-stored effective key over env (env unset)", async () => {
    // Deploy keyed only via the encrypted admin setting; env has no key. The
    // stored value is legacy-plaintext, which `decrypt` passes through as-is.
    delete process.env.EDUAI_API_KEY;
    findSystemSetting.mockResolvedValue({ key: "EDUAI_API_KEY", value: "db-effective-key" });
    global.fetch = vi.fn().mockResolvedValue(successfulResponse());

    await generateResponse();

    const [, requestInit] = global.fetch.mock.calls[0];
    expect(requestInit.headers.Authorization).toBe("Bearer db-effective-key");
    expect(requestInit.headers.cookie).toBe("session=service-key-test");
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
