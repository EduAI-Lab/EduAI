import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  buildCourseScopePromptBlock,
  buildScopeRefusalMessage,
  evaluateCourseScope,
  hasCourseMetadataOverlap,
  isClearlyOffTopic,
  isCodingScopeAllowlisted,
  isCourseScopeGateEnabled,
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
  it("detects overlap with course topics", () => {
    expect(hasCourseMetadataOverlap("What is convolution used for?", IMAGE_COURSE)).toBe(
      true,
    );
  });

  it("returns false when the message shares no course metadata tokens", () => {
    expect(hasCourseMetadataOverlap("What is linear algebra?", IMAGE_COURSE)).toBe(false);
  });
});

describe("isClearlyOffTopic", () => {
  it("flags baking questions in a CS course", () => {
    expect(isClearlyOffTopic("How do I bake chocolate chip cookies?", COURSE)).toBe(
      true,
    );
  });

  it("does not flag baking when the course metadata mentions it", () => {
    const bakingCourse = {
      ...COURSE,
      topics: ["cookies"],
    };
    expect(
      isClearlyOffTopic("How do I bake chocolate chip cookies?", bakingCourse),
    ).toBe(false);
  });
});

describe("isCodingScopeAllowlisted", () => {
  it("allows debug-my-code style requests", () => {
    expect(isCodingScopeAllowlisted("Can you debug my Python function?")).toBe(true);
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

  it("refuses clearly off-topic questions with zero RAG hits", () => {
    const result = evaluateCourseScope({
      message: "How do I bake chocolate chip cookies?",
      hasCourse: true,
      hits: [],
      course: COURSE,
    });
    expect(result.decision).toBe("refuse");
    expect(result.reason).toBe("clearly_off_topic");
  });

  it("allows related foundational questions with zero RAG hits (soft scope)", () => {
    const result = evaluateCourseScope({
      message: "What is linear algebra?",
      hasCourse: true,
      hits: [],
      course: IMAGE_COURSE,
    });
    expect(result.decision).toBe("allow");
    expect(result.reason).toBe("soft_scope_llm");
  });

  it("allows substantive questions when RAG returns hits", () => {
    const result = evaluateCourseScope({
      message: "What is gradient descent?",
      hasCourse: true,
      hits: [{ content: "GD", similarity: 0.7, materialTitle: "Lecture 3" }],
      course: COURSE,
    });
    expect(result.decision).toBe("allow");
    expect(result.reason).toBe("rag_hits_present");
  });

  it("allows zero-hit questions that overlap course metadata", () => {
    const result = evaluateCourseScope({
      message: "Explain convolution for this course",
      hasCourse: true,
      hits: [],
      course: IMAGE_COURSE,
    });
    expect(result.decision).toBe("allow");
    expect(result.reason).toBe("course_metadata_overlap");
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

  it("allowlists coding requests even with zero hits", () => {
    const result = evaluateCourseScope({
      message: "Debug my JavaScript function for the lab",
      hasCourse: true,
      hits: [],
      course: COURSE,
    });
    expect(result.decision).toBe("allow");
    expect(result.reason).toBe("coding_allowlisted");
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
