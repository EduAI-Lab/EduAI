import { describe, it, expect, afterEach, vi } from "vitest";
import {
  parseCourseScopeJson,
  buildCourseScopeRedirectMessage,
  courseScopeGuardrailEnabled,
  resolveCourseScopeVerdict,
  shouldSkipCourseScopeCheck,
} from "~/lib/ai/course-scope-guardrail";

const baseContext = {
  courseName: "Intro to Programming",
  courseCode: "COSC 111",
  courseDescription: "Fundamentals of programming in Python.",
  aiInstructions: "",
};

afterEach(() => {
  delete process.env.COURSE_SCOPE_GUARDRAIL_ENABLED;
  delete process.env.COURSE_SCOPE_MIN_CONFIDENCE;
  vi.restoreAllMocks();
  vi.doUnmock("~/lib/ai/routing/classifier-client");
});

describe("courseScopeGuardrailEnabled", () => {
  it("defaults to disabled", () => {
    expect(courseScopeGuardrailEnabled()).toBe(false);
  });

  it("is enabled by '1' or 'true'", () => {
    process.env.COURSE_SCOPE_GUARDRAIL_ENABLED = "1";
    expect(courseScopeGuardrailEnabled()).toBe(true);
    process.env.COURSE_SCOPE_GUARDRAIL_ENABLED = "true";
    expect(courseScopeGuardrailEnabled()).toBe(true);
    process.env.COURSE_SCOPE_GUARDRAIL_ENABLED = "false";
    expect(courseScopeGuardrailEnabled()).toBe(false);
  });
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

  it("does NOT skip off-topic requests that merely start with a greeting word", () => {
    // Regression: a leading-anchor greeting match let these bypass the gate.
    expect(shouldSkipCourseScopeCheck("ok what's the weather today")).toBe(false);
    expect(shouldSkipCourseScopeCheck("hey write me a poem about cats")).toBe(false);
    expect(shouldSkipCourseScopeCheck("what is the deadline for a2")).toBe(false);
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
