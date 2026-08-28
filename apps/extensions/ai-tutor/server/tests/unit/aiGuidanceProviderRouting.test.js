import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    // `serviceAuthHeader` sends the env `EDUAI_API_KEY`, not this override;
    // the stub is kept so any `getEffectiveEduAiApiKey` read stays deterministic.
    systemSetting: { findUnique: vi.fn().mockResolvedValue(null) },
    promptTemplate: {
      findUnique: vi.fn().mockResolvedValue({ systemPrompt: "Be a safe tutor." }),
    },
  },
}));

vi.mock("../../src/services/eduaiClient.js", () => ({
  getEduAiCompletionUrl: () => "http://eduai.test/api/completion",
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function activity() {
  return {
    mainTopic: { name: "Algebra" },
    config: { question: "What is x?", questionType: "SHORT_TEXT" },
  };
}

describe("BYOK provider routing", () => {
  it("never sends a tutor provider key to a different-provider supervisor", async () => {
    const googleKey = "google-canary-secret";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ content: "Try isolating x." }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ content: '{"approved":true}' }),
        }),
    );

    const { generateGuideResponse } = await import("../../src/services/aiGuidance.js");
    const result = await generateGuideResponse({
      activity: activity(),
      knowledgeLevel: "beginner",
      message: "Give me a hint",
      studentAnswer: null,
      tutorModelId: "google:gemini-test",
      supervisorModelId: "openai:gpt-test",
      dualLoopEnabled: true,
      maxSupervisorIterations: 1,
      cookie: "session=canary",
      apiKey: googleKey,
    });

    const requests = global.fetch.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(requests.filter((request) => request.model.startsWith("openai:"))).toHaveLength(0);
    expect(requests.every((request) => JSON.stringify(request).includes(googleKey))).toBe(true);
    expect(result.message).toBe("Try isolating x.");
  });

  it("uses distinct canary secrets for tutor and supervisor fallback iterations", async () => {
    const googleKey = "google-canary-secret";
    const openAiKey = "openai-canary-secret";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ content: "First draft." }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ content: '{"approved":false,"feedbackToTutor":"Try again."}' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ content: "Revised draft." }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ content: '{"approved":true}' }),
        }),
    );

    const { generateGuideResponse } = await import("../../src/services/aiGuidance.js");
    await generateGuideResponse({
      activity: activity(),
      knowledgeLevel: "beginner",
      message: "Give me a hint",
      studentAnswer: null,
      tutorModelId: "google:gemini-test",
      supervisorModelId: "openai:gpt-test",
      apiKey: googleKey,
      apiKeys: { google: googleKey, openai: openAiKey },
      dualLoopEnabled: true,
      maxSupervisorIterations: 2,
      cookie: "session=canary",
    });

    const requests = global.fetch.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(requests).toHaveLength(4);
    expect(requests[0].model).toBe("google:gemini-test");
    expect(requests[0].apiKeys.google.apiKey).toBe(googleKey);
    expect(requests[0].apiKeys.openai).toBeUndefined();
    expect(requests[1].model).toBe("openai:gpt-test");
    expect(requests[1].apiKeys.openai.apiKey).toBe(openAiKey);
    expect(requests[1].apiKeys.google).toBeUndefined();
    expect(requests[2].model).toBe("google:gemini-test");
    expect(requests[2].apiKeys.google.apiKey).toBe(googleKey);
    expect(requests[3].model).toBe("openai:gpt-test");
    expect(requests[3].apiKeys.openai.apiKey).toBe(openAiKey);
  });
});
