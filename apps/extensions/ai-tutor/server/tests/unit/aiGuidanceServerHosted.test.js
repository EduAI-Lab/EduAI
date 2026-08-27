/**
 * Covers #1645 facet 1 (server side): a BYOK key is required only for BYOK
 * providers. UBC-hosted models (vllm/ollama) are served with the deployment key
 * Core injects, so they proceed with no student key — and their supervisor pass
 * stays available. BYOK providers with no key still fail closed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/database.js", () => ({
  prisma: {
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

describe("UBC-hosted models need no BYOK key (#1645)", () => {
  it("sends a UBC-hosted tutor request with an empty apiKeys map", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: "Try isolating x." }),
      }),
    );

    const { generateGuideResponse } = await import("../../src/services/aiGuidance.js");
    const result = await generateGuideResponse({
      activity: activity(),
      knowledgeLevel: "beginner",
      message: "Give me a hint",
      studentAnswer: null,
      tutorModelId: "vllm:llama-3",
      dualLoopEnabled: false,
      cookie: "session=canary",
      // No apiKey / apiKeys at all.
    });

    expect(result.message).toBe("Try isolating x.");
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.model).toBe("vllm:llama-3");
    expect(body.apiKeys).toEqual({});
  });

  it("runs the supervisor pass for a UBC-hosted supervisor without a key", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ content: "Try isolating x." }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ content: '{"approved":true}' }) }),
    );

    const { generateGuideResponse } = await import("../../src/services/aiGuidance.js");
    const result = await generateGuideResponse({
      activity: activity(),
      knowledgeLevel: "beginner",
      message: "Give me a hint",
      studentAnswer: null,
      tutorModelId: "vllm:llama-3",
      supervisorModelId: "vllm:llama-3",
      dualLoopEnabled: true,
      maxSupervisorIterations: 1,
      cookie: "session=canary",
    });

    expect(result.message).toBe("Try isolating x.");
    expect(result.trace.finalOutcome).toBe("approved");
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const bodies = global.fetch.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(bodies.every((body) => JSON.stringify(body.apiKeys) === "{}")).toBe(true);
  });

  it("forwards every held BYOK key to Core so a UBC-hosted request can fall back (#1645)", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ content: "Try isolating x." }) }),
    );

    const { generateGuideResponse } = await import("../../src/services/aiGuidance.js");
    const result = await generateGuideResponse({
      activity: activity(),
      knowledgeLevel: "beginner",
      message: "Give me a hint",
      studentAnswer: null,
      tutorModelId: "vllm:llama-3",
      dualLoopEnabled: false,
      cookie: "session=canary",
      // The student selected a UBC-hosted model but holds an OpenAI key. The key
      // must still reach Core so its fleet-down fallback can switch to it — the
      // selected provider (vllm) needs none of its own.
      apiKeys: { openai: "sk-openai-canary" },
    });

    expect(result.message).toBe("Try isolating x.");
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.model).toBe("vllm:llama-3");
    expect(body.apiKeys).toEqual({ openai: { apiKey: "sk-openai-canary", isEnabled: true } });
  });

  it("still fails closed for a BYOK tutor model with no key", async () => {
    vi.stubGlobal("fetch", vi.fn());

    const { generateGuideResponse } = await import("../../src/services/aiGuidance.js");
    // A BYOK provider with no key rejects with a 400 the route maps to the
    // client (never reaching the model call).
    await expect(
      generateGuideResponse({
        activity: activity(),
        knowledgeLevel: "beginner",
        message: "Give me a hint",
        studentAnswer: null,
        tutorModelId: "google:gemini-test",
        dualLoopEnabled: false,
        cookie: "session=canary",
        // No key for the google BYOK provider.
      }),
    ).rejects.toThrow("API key is required for the selected tutor provider");
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
