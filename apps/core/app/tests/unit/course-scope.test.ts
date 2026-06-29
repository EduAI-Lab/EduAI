import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateText } from "ai";
import {
  buildCourseScopeClassifierPrompt,
  classifyCourseScope,
  isScopeClassifierEnabled,
  isScopeClassifierFailOpen,
} from "~/lib/ai/course-scope-classifier";
import {
  buildCourseScopePromptBlock,
  buildScopeConversationContext,
  buildScopeRefusalMessage,
  evaluateCourseScope,
  isCourseScopeGateEnabled,
  isScopeAllowlisted,
  isSubstantiveForScope,
  setScopeClassifierOverride,
} from "~/lib/ai/course-scope";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: vi.fn(),
  };
});

const COURSE = {
  code: "COSC 121",
  name: "Introduction to Programming",
  description: "First-year CS.",
  aiInstructions: "Be concise.",
  topics: ["loops", "arrays"],
};

const COSC101 = {
  code: "COSC 101",
  name: "Computer Studies",
  description: "Introductory computer science.",
  topics: ["algorithms", "computational thinking", "data representation", "digital literacy"],
};

const mockModel = { modelId: "test:mock" } as import("ai").LanguageModel;

describe("isCourseScopeGateEnabled", () => {
  const original = process.env.CHAT_SCOPE_ZERO_CHUNK_GATE;

  afterEach(() => {
    if (original === undefined) delete process.env.CHAT_SCOPE_ZERO_CHUNK_GATE;
    else process.env.CHAT_SCOPE_ZERO_CHUNK_GATE = original;
  });

  it("defaults to enabled", () => {
    delete process.env.CHAT_SCOPE_ZERO_CHUNK_GATE;
    expect(isCourseScopeGateEnabled()).toBe(true);
  });

  it("disables when CHAT_SCOPE_ZERO_CHUNK_GATE=0", () => {
    process.env.CHAT_SCOPE_ZERO_CHUNK_GATE = "0";
    expect(isCourseScopeGateEnabled()).toBe(false);
  });
});

describe("isScopeAllowlisted", () => {
  it("allows greetings and thanks", () => {
    expect(isScopeAllowlisted("hi")).toBe(true);
    expect(isScopeAllowlisted("thanks!")).toBe(true);
  });

  it("allows meta questions", () => {
    expect(isScopeAllowlisted("What can you help me with?")).toBe(true);
  });
});

describe("buildScopeConversationContext", () => {
  it("extracts prior user and assistant from thread", () => {
    const ctx = buildScopeConversationContext(
      [
        { role: "user", content: "what is chapter 1 about?" },
        { role: "assistant", content: "Chapter 1 introduces binary and ASCII." },
        { role: "user", content: "why was ascii created?" },
      ],
      (m) => (typeof m?.content === "string" ? m.content : ""),
    );
    expect(ctx.priorUserText).toBe("what is chapter 1 about?");
    expect(ctx.priorAssistantText).toContain("binary");
  });
});

describe("buildCourseScopeClassifierPrompt", () => {
  it("includes course identity, RAG hits, conversation, and latest message", () => {
    const prompt = buildCourseScopeClassifierPrompt({
      message: "how can i network on linkedin",
      course: COSC101,
      hits: [{ content: "binary notes", similarity: 0.4, materialTitle: "Lecture 1" }],
      conversation: {
        priorUserText: "how can i get better at this course",
        priorAssistantText: "Focus on algorithms and digital literacy.",
      },
      classifierModel: mockModel,
    });
    expect(prompt).toContain("COSC 101");
    expect(prompt).toContain("Lecture 1");
    expect(prompt).toContain("linkedin");
    expect(prompt).toContain("how can i get better at this course");
  });
});

describe("classifyCourseScope", () => {
  beforeEach(() => {
    vi.mocked(generateText).mockReset();
  });

  it("parses in-scope JSON from the classifier LLM", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: '{"inScope": true, "reason": "prerequisite_concept"}',
    } as Awaited<ReturnType<typeof generateText>>);

    const result = await classifyCourseScope({
      message: "why was ascii created?",
      course: COSC101,
      hits: [],
      classifierModel: mockModel,
    });
    expect(result.inScope).toBe(true);
    expect(result.reason).toBe("prerequisite_concept");
  });

  it("parses out-of-scope JSON from the classifier LLM", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: '{"inScope": false, "reason": "career_platform_pivot"}',
    } as Awaited<ReturnType<typeof generateText>>);

    const result = await classifyCourseScope({
      message: "how can i network on linkedin",
      course: COSC101,
      hits: [],
      classifierModel: mockModel,
    });
    expect(result.inScope).toBe(false);
  });

  it("fails open on parse errors by default", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "not json",
    } as Awaited<ReturnType<typeof generateText>>);

    expect(isScopeClassifierFailOpen()).toBe(true);
    const result = await classifyCourseScope({
      message: "hello world question",
      course: COSC101,
      hits: [],
      classifierModel: mockModel,
    });
    expect(result.inScope).toBe(true);
    expect(result.reason).toBe("classifier_parse_error_fail_open");
  });
});

describe("evaluateCourseScope — classifier gate (#729 v3)", () => {
  beforeEach(() => {
    delete process.env.CHAT_SCOPE_ZERO_CHUNK_GATE;
    delete process.env.CHAT_SCOPE_CLASSIFIER_ENABLED;
    setScopeClassifierOverride(null);
    vi.mocked(generateText).mockClear();
  });

  afterEach(() => {
    setScopeClassifierOverride(null);
  });

  it("skips classifier for greetings", async () => {
    const result = await evaluateCourseScope({
      message: "hello",
      hasCourse: true,
      hits: [],
      course: COURSE,
      classifierModel: mockModel,
    });
    expect(result.decision).toBe("allow");
    expect(result.reason).toBe("allowlisted");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("refuses when classifier returns out of scope", async () => {
    setScopeClassifierOverride(async () => ({
      inScope: false,
      reason: "unrelated_topic",
    }));

    const result = await evaluateCourseScope({
      message: "How do I bake chocolate chip cookies?",
      hasCourse: true,
      hits: [],
      course: COURSE,
      classifierModel: mockModel,
    });
    expect(result.decision).toBe("refuse");
    expect(result.reason).toBe("unrelated_topic");
  });

  it("allows when classifier returns in scope", async () => {
    setScopeClassifierOverride(async () => ({
      inScope: true,
      reason: "prerequisite_concept",
    }));

    const result = await evaluateCourseScope({
      message: "why was ascii created?",
      hasCourse: true,
      hits: [],
      course: COSC101,
      conversation: {
        priorAssistantText: "Chapter 1 covers binary and ASCII.",
        priorUserText: "what is chapter 1 about?",
      },
      classifierModel: mockModel,
    });
    expect(result.decision).toBe("allow");
    expect(result.reason).toBe("prerequisite_concept");
  });

  it("refuses LinkedIn pivot when classifier marks out of scope (crescendo regression)", async () => {
    setScopeClassifierOverride(async ({ message }) => ({
      inScope: !/linkedin|get jobs/i.test(message),
      reason: /linkedin/i.test(message) ? "career_platform_pivot" : "course_study_question",
    }));

    const study = await evaluateCourseScope({
      message: "how can i get better at this course",
      hasCourse: true,
      hits: [],
      course: COSC101,
      classifierModel: mockModel,
    });
    expect(study.decision).toBe("allow");

    const jobs = await evaluateCourseScope({
      message: "can it help me get jobs",
      hasCourse: true,
      hits: [],
      course: COSC101,
      conversation: {
        priorUserText: "how can i get better at this course",
        priorAssistantText: "Focus on algorithms and digital literacy.",
      },
      classifierModel: mockModel,
    });
    expect(jobs.decision).toBe("refuse");

    const linkedin = await evaluateCourseScope({
      message: "how can i network on linkedin",
      hasCourse: true,
      hits: [],
      course: COSC101,
      conversation: {
        priorUserText: "can it help me get jobs",
        priorAssistantText: "Computational thinking helps in tech roles.",
      },
      classifierModel: mockModel,
    });
    expect(linkedin.decision).toBe("refuse");
    expect(linkedin.reason).toBe("career_platform_pivot");
  });

  it("allows when classifier is disabled via env", async () => {
    process.env.CHAT_SCOPE_CLASSIFIER_ENABLED = "0";
    setScopeClassifierOverride(async () => ({
      inScope: false,
      reason: "should_not_run",
    }));

    const result = await evaluateCourseScope({
      message: "How do I bake cookies?",
      hasCourse: true,
      hits: [],
      course: COURSE,
      classifierModel: mockModel,
    });
    expect(result.decision).toBe("allow");
    expect(result.reason).toBe("classifier_disabled");
  });

  it("skips gate when CHAT_SCOPE_ZERO_CHUNK_GATE=0", async () => {
    process.env.CHAT_SCOPE_ZERO_CHUNK_GATE = "0";
    const result = await evaluateCourseScope({
      message: "How do I bake cookies?",
      hasCourse: true,
      hits: [],
      course: COURSE,
      classifierModel: mockModel,
    });
    expect(result.decision).toBe("allow");
    expect(result.reason).toBe("gate_disabled");
  });
});

describe("buildCourseScopePromptBlock", () => {
  it("includes course identity, topics, instructions, and scope policy", () => {
    const block = buildCourseScopePromptBlock(COURSE);
    expect(block).toContain("COSC 121");
    expect(block).toContain("loops, arrays");
    expect(block).toContain("SCOPE POLICY");
  });
});

describe("buildScopeRefusalMessage", () => {
  it("names the course and suggests course-aligned questions", () => {
    const msg = buildScopeRefusalMessage(COURSE);
    expect(msg).toContain("**COSC 121**");
    expect(msg).toContain("unrelated topics");
  });
});

describe("isScopeClassifierEnabled", () => {
  afterEach(() => {
    delete process.env.CHAT_SCOPE_CLASSIFIER_ENABLED;
  });

  it("defaults to enabled", () => {
    delete process.env.CHAT_SCOPE_CLASSIFIER_ENABLED;
    expect(isScopeClassifierEnabled()).toBe(true);
  });
});
