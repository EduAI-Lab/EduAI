import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  buildCourseScopePromptBlock,
  buildScopeRefusalMessage,
  evaluateCourseScope,
  hasCourseMetadataOverlap,
  hasCourseIntentSignals,
  hasScopeRelevantRagHits,
  isCodingScopeAllowlisted,
  isCourseScopeGateEnabled,
  isFoundationalAdjacent,
  isOffTopicDomain,
  isScopeAllowlisted,
  isSubstantiveForScope,
} from "~/lib/ai/course-scope";

const COURSE = {
  code: "COSC 121",
  name: "Introduction to Programming",
  description: "First-year CS.",
  aiInstructions: "Be concise.",
  topics: ["loops", "arrays"],
};

const COSC121_SCREENSHOT_COURSE = {
  code: "COSC 121",
  name: "Computer Programming II",
  description: "Second-year programming course.",
  aiInstructions: null,
  topics: ["loops", "arrays", "functions"],
};

const IMAGE_COURSE = {
  code: "COSC 425",
  name: "Image Processing",
  description: "Filters, convolution, and vision pipelines.",
  aiInstructions: null,
  topics: ["convolution", "filters", "frequency domain"],
};

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
    expect(isScopeAllowlisted("Hello there")).toBe(true);
    expect(isScopeAllowlisted("thanks!")).toBe(true);
  });

  it("allows meta questions", () => {
    expect(isScopeAllowlisted("What can you help me with?")).toBe(true);
  });

  it("does not allowlist off-topic substantive questions", () => {
    expect(isScopeAllowlisted("How do I bake chocolate chip cookies?")).toBe(false);
  });
});

describe("hasCourseMetadataOverlap", () => {
  it("detects overlap with course topics when course intent is present", () => {
    expect(
      hasCourseMetadataOverlap("What does the lecture say about convolution?", IMAGE_COURSE),
    ).toBe(true);
  });

  it("detects overlap with explicit course code", () => {
    expect(hasCourseMetadataOverlap("Is COSC 121 hard?", COURSE)).toBe(true);
  });

  it("returns false for bare topic tokens without course intent", () => {
    expect(hasCourseMetadataOverlap("Tell me about arrays in music", COURSE)).toBe(false);
    expect(hasCourseMetadataOverlap("loops in roller coasters", COURSE)).toBe(false);
  });

  it("returns false for generic description tokens like year/first", () => {
    expect(hasCourseMetadataOverlap("Who won the super bowl last year?", COURSE)).toBe(false);
    expect(hasCourseMetadataOverlap("What happened first in history?", COURSE)).toBe(false);
  });

  it("returns false when the message shares no course metadata tokens", () => {
    expect(hasCourseMetadataOverlap("What is linear algebra?", IMAGE_COURSE)).toBe(false);
  });
});

describe("hasScopeRelevantRagHits", () => {
  it("ignores weak similarity hits", () => {
    expect(
      hasScopeRelevantRagHits([
        { content: "noise", similarity: 0.4, materialTitle: "Syllabus" },
      ]),
    ).toBe(false);
  });

  it("accepts hits at or above the moderate inject threshold", () => {
    expect(
      hasScopeRelevantRagHits([
        { content: "notes", similarity: 0.6, materialTitle: "Lecture" },
      ]),
    ).toBe(true);
  });
});

describe("isFoundationalAdjacent", () => {
  it("allows prerequisite STEM questions for technical courses", () => {
    expect(isFoundationalAdjacent("What is linear algebra?", IMAGE_COURSE)).toBe(true);
  });

  it("rejects clearly non-academic topics", () => {
    expect(isFoundationalAdjacent("Tell me about World War 2", IMAGE_COURSE)).toBe(false);
  });
});

describe("isCodingScopeAllowlisted", () => {
  it("allows debug-my-code requests with course context", () => {
    expect(isCodingScopeAllowlisted("Can you debug my Python function for the lab?")).toBe(
      true,
    );
  });

  it("rejects generic coding requests without course context", () => {
    expect(
      isCodingScopeAllowlisted(
        "Write Python code to sort a list of countries by population",
      ),
    ).toBe(false);
  });
});

describe("hasCourseIntentSignals", () => {
  it("detects assignment and lecture wording", () => {
    expect(hasCourseIntentSignals("What does the syllabus say?")).toBe(true);
    expect(hasCourseIntentSignals("Tell me about dinosaurs")).toBe(false);
  });
});

describe("isSubstantiveForScope", () => {
  it("treats questions with ? as substantive", () => {
    expect(isSubstantiveForScope("How do I bake cookies?")).toBe(true);
  });

  it("treats long statements as substantive", () => {
    expect(
      isSubstantiveForScope("Tell me everything about baking sourdough bread at home"),
    ).toBe(true);
  });
});

describe("evaluateCourseScope", () => {
  beforeEach(() => {
    delete process.env.CHAT_SCOPE_ZERO_CHUNK_GATE;
  });

  it("refuses off-topic questions with zero RAG hits", () => {
    for (const message of [
      "How do I bake chocolate chip cookies?",
      "Tell me about World War 2",
      "What is the capital of France?",
      "How do I invest in stocks?",
    ]) {
      const result = evaluateCourseScope({
        message,
        hasCourse: true,
        hits: [],
        course: COURSE,
      });
      expect(result.decision).toBe("refuse");
      expect(result.reason).toBe("zero_hit_off_topic");
    }
  });

  it("allows related foundational questions with zero RAG hits", () => {
    const result = evaluateCourseScope({
      message: "What is linear algebra?",
      hasCourse: true,
      hits: [],
      course: IMAGE_COURSE,
    });
    expect(result.decision).toBe("allow");
    expect(result.reason).toBe("foundational_adjacent");
  });

  it("allows substantive questions when RAG returns strong hits", () => {
    const result = evaluateCourseScope({
      message: "What is gradient descent?",
      hasCourse: true,
      hits: [{ content: "GD", similarity: 0.7, materialTitle: "Lecture 3" }],
      course: COURSE,
    });
    expect(result.decision).toBe("allow");
    expect(result.reason).toBe("rag_hits_present");
  });

  it("refuses off-topic questions even when RAG returns weak hits", () => {
    const result = evaluateCourseScope({
      message: "Tell me about World War 2",
      hasCourse: true,
      hits: [{ content: "noise", similarity: 0.4, materialTitle: "Syllabus" }],
      course: COURSE,
    });
    expect(result.decision).toBe("refuse");
    expect(result.reason).toBe("zero_hit_off_topic");
  });

  it("allows zero-hit questions with course material intent", () => {
    const result = evaluateCourseScope({
      message: "What did chapter 3 say about trees?",
      hasCourse: true,
      hits: [],
      course: COURSE,
    });
    expect(result.decision).toBe("allow");
    expect(result.reason).toBe("course_material_intent");
  });

  it("allows foundational STEM questions for COSC courses with zero hits", () => {
    const result = evaluateCourseScope({
      message: "What is gradient descent?",
      hasCourse: true,
      hits: [],
      course: COURSE,
    });
    expect(result.decision).toBe("allow");
    expect(result.reason).toBe("foundational_adjacent");
  });

  it("allows zero-hit questions that overlap course metadata with intent", () => {
    const result = evaluateCourseScope({
      message: "Explain convolution for this course",
      hasCourse: true,
      hits: [],
      course: IMAGE_COURSE,
    });
    expect(result.decision).toBe("allow");
    expect(result.reason).toBe("course_material_intent");
  });

  it("allowlists greetings without checking hits", () => {
    const result = evaluateCourseScope({
      message: "hello",
      hasCourse: true,
      hits: [],
      course: COURSE,
    });
    expect(result.decision).toBe("allow");
    expect(result.reason).toBe("allowlisted");
  });

  it("allowlists coding requests with course context and zero hits", () => {
    const result = evaluateCourseScope({
      message: "Debug my JavaScript function for the lab",
      hasCourse: true,
      hits: [],
      course: COURSE,
    });
    expect(result.decision).toBe("allow");
    expect(result.reason).toBe("coding_allowlisted");
  });

  it("refuses coding requests without course context", () => {
    const result = evaluateCourseScope({
      message: "Write Python code to sort countries by population",
      hasCourse: true,
      hits: [],
      course: COURSE,
    });
    expect(result.decision).toBe("refuse");
    expect(result.reason).toBe("zero_hit_off_topic");
  });

  it("skips gate when disabled via env", () => {
    process.env.CHAT_SCOPE_ZERO_CHUNK_GATE = "0";
    const result = evaluateCourseScope({
      message: "How do I bake cookies?",
      hasCourse: true,
      hits: [],
      course: COURSE,
    });
    expect(result.decision).toBe("allow");
    expect(result.reason).toBe("gate_disabled");
  });
});

describe("superbolt08 screenshot regression (#729)", () => {
  const screenshotPrompts = [
    "i need to know how i can limit social media time",
    "why is it that walking everyday improves overall health?",
    "where was world war II held?",
    "how many people attended world war ii",
  ];

  beforeEach(() => {
    delete process.env.CHAT_SCOPE_ZERO_CHUNK_GATE;
  });

  it("flags screenshot prompts as off-topic domains", () => {
    for (const message of screenshotPrompts) {
      expect(isOffTopicDomain(message)).toBe(true);
    }
  });

  it("hard-refuses screenshot prompts with zero RAG hits", () => {
    for (const message of screenshotPrompts) {
      const result = evaluateCourseScope({
        message,
        hasCourse: true,
        hits: [],
        course: COSC121_SCREENSHOT_COURSE,
      });
      expect(result.decision).toBe("refuse");
      expect(result.reason).toBe("zero_hit_off_topic");
    }
  });

  it("hard-refuses screenshot prompts even when RAG returns moderate hits", () => {
    for (const message of screenshotPrompts) {
      const result = evaluateCourseScope({
        message,
        hasCourse: true,
        hits: [{ content: "noise", similarity: 0.62, materialTitle: "Syllabus" }],
        course: COSC121_SCREENSHOT_COURSE,
      });
      expect(result.decision).toBe("refuse");
      expect(result.reason).toBe("off_topic_despite_rag");
    }
  });
});

describe("buildCourseScopePromptBlock", () => {
  it("includes course identity, topics, instructions, and scope policy", () => {
    const block = buildCourseScopePromptBlock(COURSE);
    expect(block).toContain("COSC 121");
    expect(block).toContain("Introduction to Programming");
    expect(block).toContain("loops, arrays");
    expect(block).toContain("Be concise");
    expect(block).toContain("SCOPE POLICY");
    expect(block).toContain("foundational concepts");
  });
});

describe("buildScopeRefusalMessage", () => {
  it("names the course and suggests course-aligned questions", () => {
    const msg = buildScopeRefusalMessage(COURSE);
    expect(msg).toContain("**COSC 121**");
    expect(msg).toContain("unrelated topics");
    expect(msg).toContain("lecture");
  });
});
