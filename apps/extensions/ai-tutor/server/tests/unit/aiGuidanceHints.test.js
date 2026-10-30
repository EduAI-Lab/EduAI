/**
 * #2029: instructor hints saved on an activity reach the tutor (and the
 * supervisor) from the stored activity config.
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

const HINT = "Think about when it should stop.";

function activity(hints) {
  return {
    mainTopic: { name: "Recursion" },
    customPrompt: "Custom tutor prompt.",
    config: {
      questionType: "MCQ",
      question: "When does recursion end?",
      options: ["Never", "At the base case"],
      answer: { correctIndex: 1 },
      hints,
    },
  };
}

function stubTutorAndSupervisor() {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ content: "What makes it stop?" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ content: '{"approved":true}' }) }),
  );
}

const baseArgs = {
  knowledgeLevel: "beginner",
  message: "I'm stuck",
  studentAnswer: 0,
  tutorModelId: "vllm:llama-3",
  supervisorModelId: "vllm:llama-3",
  dualLoopEnabled: true,
  maxSupervisorIterations: 1,
  cookie: "session=canary",
};

describe("activity hints in tutor context (#2029)", () => {
  for (const name of ["generateGuideResponse", "generateCustomResponse", "generateTeachResponse"]) {
    it(`${name} sends stored hints to the tutor and supervisor`, async () => {
      stubTutorAndSupervisor();
      const mod = await import("../../src/services/aiGuidance.js");
      const result = await mod[name]({ ...baseArgs, activity: activity([HINT]) });

      expect(result.trace.finalOutcome).toBe("approved");
      const [tutorBody, supervisorBody] = global.fetch.mock.calls.map(([, init]) => init.body);
      expect(tutorBody).toContain("Instructor-provided hints");
      expect(tutorBody).toContain(HINT);
      expect(supervisorBody).toContain(HINT);
      expect(result.trace.hiddenContext).toContain(HINT);
    });
  }

  it("omits the hints block when the activity has no hints", async () => {
    stubTutorAndSupervisor();
    const { generateGuideResponse } = await import("../../src/services/aiGuidance.js");
    await generateGuideResponse({ ...baseArgs, activity: activity([]) });

    const tutorBody = global.fetch.mock.calls[0][1].body;
    expect(tutorBody).not.toContain("Instructor-provided hints");
  });
});
