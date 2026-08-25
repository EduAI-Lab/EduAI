/**
 * #1647: the tutor's server-to-server call to Core's `/api/completion`
 * forwarded only Content-Type + the user cookie. Core's mutation guard
 * (`root.tsx`) rejects a cookie-bearing unsafe-method request that cannot prove
 * same-origin unless it presents the service key, so in a split-origin topology
 * the call was refused with CROSS_ORIGIN_MUTATION (403) before any model ran.
 * `callEduAI` must send `Authorization: Bearer <EDUAI_API_KEY>` like the other
 * eduaiClient reads, while keeping the cookie for user identity / rate-limiting.
 *
 * Fetch is mocked in-process, so these tests never contact the real endpoint.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    promptTemplate: {
      findUnique: vi.fn().mockResolvedValue({
        systemPrompt: "Be a helpful tutor.",
      }),
    },
  },
}));

vi.mock("../../src/services/eduaiClient.js", () => ({
  getEduAiCompletionUrl: () => "http://not-actually-called.test/api/completion",
}));

const originalFetch = global.fetch;
const originalServiceKey = process.env.EDUAI_API_KEY;

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
  it("sends Authorization: Bearer <EDUAI_API_KEY> on the completion call", async () => {
    process.env.EDUAI_API_KEY = "svc-secret-123";
    global.fetch = vi.fn().mockResolvedValue(successfulResponse());

    await generateResponse();

    const [, requestInit] = global.fetch.mock.calls[0];
    expect(requestInit.headers.Authorization).toBe("Bearer svc-secret-123");
    // Cookie is still forwarded for user identity / rate-limiting.
    expect(requestInit.headers.cookie).toBe("session=service-key-test");
  });

  it("omits the Authorization header when no service key is configured", async () => {
    delete process.env.EDUAI_API_KEY;
    global.fetch = vi.fn().mockResolvedValue(successfulResponse());

    await generateResponse();

    const [, requestInit] = global.fetch.mock.calls[0];
    expect(requestInit.headers.Authorization).toBeUndefined();
    expect(requestInit.headers.cookie).toBe("session=service-key-test");
  });
});
