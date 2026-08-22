/**
 * #1606: EduAI Core restricts custom system prompts to course staff. AI Tutor
 * composes its tutoring prompt on THIS server but forwards the *learner's*
 * cookie, so Core cannot tell the two apart from the cookie alone — the shared
 * service key is what proves first-party origin. Without the bearer header Core
 * returns 403 SYSTEM_PROMPT_FORBIDDEN, exactly as it would for a learner's own
 * browser, and tutoring breaks.
 *
 * Fetch is mocked in-process, so these tests never contact EduAI.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    promptTemplate: {
      findUnique: vi.fn().mockResolvedValue({ systemPrompt: "Be a helpful tutor." }),
    },
  },
}));

vi.mock("../../src/services/eduaiClient.js", () => ({
  getEduAiCompletionUrl: () => "http://not-actually-called.test/api/completion",
}));

const originalFetch = global.fetch;
const originalKey = process.env.EDUAI_API_KEY;

beforeEach(() => {
  process.env.EDUAI_API_KEY = "test-service-key";
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ content: "Start by identifying the base case." }),
  });
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.EDUAI_API_KEY;
  else process.env.EDUAI_API_KEY = originalKey;
  vi.restoreAllMocks();
});

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

/** Headers from the single recorded fetch call. */
const sentHeaders = () => global.fetch.mock.calls[0][1].headers;

describe("callEduAI service-key authentication (#1606)", () => {
  it("sends the service key as a bearer token", async () => {
    await generateResponse();
    expect(sentHeaders().Authorization).toBe("Bearer test-service-key");
  });

  it("still forwards the learner cookie alongside it", async () => {
    // Both are required, for different reasons: the key authorizes the custom
    // prompt, the cookie scopes the call to the learner. Dropping the cookie
    // would silently widen access.
    await generateResponse();
    expect(sentHeaders().cookie).toBe("session=service-key-test");
  });

  it("still sends the composed system prompt in the body", async () => {
    await generateResponse();
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(typeof body.systemPrompt).toBe("string");
    expect(body.systemPrompt.length).toBeGreaterThan(0);
  });

  it("fails fast with a named error when the key is not configured", async () => {
    // A clear configuration error beats an opaque 403 from Core, and beats
    // burning the retry budget on a request that can never succeed.
    delete process.env.EDUAI_API_KEY;
    await expect(generateResponse()).rejects.toThrow("EDUAI_API_KEY not configured");
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
