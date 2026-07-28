import { describe, it, expect, afterEach, vi } from "vitest";
import {
  parseCourseScopeJson,
  buildCourseScopePolicyPrompt,
  buildCourseScopeRedirectMessage,
  resolveCourseScopeVerdict,
  shouldSkipCourseScopeCheck,
} from "~/lib/ai/course-scope-guardrail";

const baseContext = {
  courseName: "Intro to Programming",
  courseCode: "COSC 111",
  courseDescription: "Fundamentals of programming in Python.",
  courseTopics: ["Variables", "Functions"],
  aiInstructions: "",
};

afterEach(() => {
  delete process.env.COURSE_SCOPE_MIN_CONFIDENCE;
  vi.restoreAllMocks();
  vi.doUnmock("~/lib/ai/routing/classifier-client");
});

describe("parseCourseScopeJson", () => {
  it("parses a bare JSON object", () => {
    const out = parseCourseScopeJson('{"onTopic":false,"confidence":85}');
    expect(out.onTopic).toBe(false);
    expect(out.confidence).toBe(85);
  });

  it("extracts JSON from surrounding text", () => {
    const out = parseCourseScopeJson(
      'Sure, here it is:\n{"onTopic":true,"confidence":92}\n',
    );
    expect(out.onTopic).toBe(true);
  });

  it("throws when no JSON object is present", () => {
    expect(() => parseCourseScopeJson("not json at all")).toThrow();
  });

  it("throws when the JSON doesn't match the schema", () => {
    expect(() => parseCourseScopeJson('{"onTopic":"yes"}')).toThrow();
  });
});

describe("buildCourseScopePolicyPrompt", () => {
  it("includes the full course identity and conservative scope rule", () => {
    const prompt = buildCourseScopePolicyPrompt(baseContext);

    expect(prompt).toContain("Intro to Programming");
    expect(prompt).toContain("COSC 111");
    expect(prompt).toContain("Variables, Functions");
    expect(prompt).toMatch(
      /does not by itself make an unrelated\s+request course-related/,
    );
    expect(prompt).toContain("plausible or uncertain");
  });
});

describe("buildCourseScopeRedirectMessage", () => {
  it("includes the course name when provided", () => {
    expect(buildCourseScopeRedirectMessage("COSC 111")).toContain("COSC 111");
  });

  it("falls back to a generic phrase when course name is null", () => {
    expect(buildCourseScopeRedirectMessage(null)).toContain("this course");
  });
});

describe("shouldSkipCourseScopeCheck", () => {
  it("skips empty and pure-greeting messages", () => {
    expect(shouldSkipCourseScopeCheck("   ")).toBe(true);
    expect(shouldSkipCourseScopeCheck("hi")).toBe(true);
    expect(shouldSkipCourseScopeCheck("hey, thanks!")).toBe(true);
    expect(shouldSkipCourseScopeCheck("good morning")).toBe(true);
  });

  it("does not trust course-associated keywords as a bypass", () => {
    expect(
      shouldSkipCourseScopeCheck("Can you translate the assignment instructions?"),
    ).toBe(false);
    expect(
      shouldSkipCourseScopeCheck("Help me email my professor about an extension"),
    ).toBe(false);
    expect(
      shouldSkipCourseScopeCheck("Write my professor a chocolate-cake recipe"),
    ).toBe(false);
  });

  it("does NOT skip off-topic requests that merely start with a greeting word", () => {
    // Regression: a leading-anchor greeting match let these bypass the gate.
    expect(shouldSkipCourseScopeCheck("ok what's the weather today")).toBe(false);
    expect(shouldSkipCourseScopeCheck("hey write me a poem about cats")).toBe(false);
  });

  it("does not mistake non-Latin questions for punctuation-only input", () => {
    expect(shouldSkipCourseScopeCheck("ما هو الطقس اليوم؟")).toBe(false);
    expect(shouldSkipCourseScopeCheck("今天的天气怎么样？")).toBe(false);
  });
});

describe("resolveCourseScopeVerdict", () => {
  it("skips the classifier call entirely for greetings", async () => {
    const verdict = await resolveCourseScopeVerdict({
      message: "hey, thanks!",
      context: baseContext,
    });
    expect(verdict).toEqual({ blocked: false, classification: null });
  });

  it("skips the classifier call entirely for empty messages", async () => {
    const verdict = await resolveCourseScopeVerdict({
      message: "   ",
      context: baseContext,
    });
    expect(verdict).toEqual({ blocked: false, classification: null });
  });

  it("fails open (blocked: false) when the classifier call throws", async () => {
    vi.doMock("~/lib/ai/routing/classifier-client", () => ({
      createClassifierClient: () => {
        throw new Error("host unreachable");
      },
    }));
    vi.resetModules();
    const { resolveCourseScopeVerdict: resolveWithMock } = await import(
      "~/lib/ai/course-scope-guardrail"
    );
    const verdict = await resolveWithMock({
      message: "What's the deadline for assignment 2?",
      context: baseContext,
    });
    expect(verdict.blocked).toBe(false);
    expect(verdict.classification).toBeNull();
  });
});
