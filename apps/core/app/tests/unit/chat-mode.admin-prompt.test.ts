import { describe, expect, it } from "vitest";

import {
  buildAdminSystemPrompt,
  buildInstructorSystemPrompt,
  buildLearningAssistantSystemPrompt,
  buildLearningSystemPrompt,
  chatbotTypeFromMode,
  formatAdminCourseContext,
  formatAdminWriteSafetyRules,
  parseChatMode,
} from "~/lib/agent-tools/chat-mode";

describe("formatAdminCourseContext", () => {
  it("describes platform-wide admin chat with explicit course in tools", () => {
    const text = formatAdminCourseContext();
    expect(text).toContain("platform-wide");
    expect(text).toContain("listCourseEnrollments");
    expect(text).toContain("courseId or courseCode");
    expect(text).toContain("userId or userEmail");
  });
});

describe("buildAdminSystemPrompt", () => {
  it("appends scope note even when a custom prompt override is set", () => {
    const prompt = buildAdminSystemPrompt({
      customPrompt: "Custom admin instructions.",
    });
    expect(prompt).toContain("Custom admin instructions.");
    expect(prompt).toContain("platform-wide");
    expect(prompt).toContain("listCourseEnrollments");
  });

  it("appends write-safety confirmation rules even when a custom prompt override is set (#988)", () => {
    const prompt = buildAdminSystemPrompt({
      customPrompt: "Custom admin instructions.",
    });
    expect(prompt).toContain("Write safety:");
    expect(prompt).toContain("confirmed: true");
    expect(prompt).toContain("CONFIRMATION_REQUIRED");
  });

  it("uses the same write-safety text in both the default and custom-prompt prompts", () => {
    const defaultPrompt = buildAdminSystemPrompt({ customPrompt: null });
    const rules = formatAdminWriteSafetyRules();
    expect(defaultPrompt).toContain(rules);
  });

  it("instructs exact email lookup and forbids similar-email guesses", () => {
    const prompt = buildAdminSystemPrompt({ customPrompt: null });
    expect(prompt).toContain("listUsers with email=");
    expect(prompt).toContain("do NOT guess a different email");
    expect(prompt).toContain("NEVER replace an admin-supplied email");
  });
});

// #1659 review (ariqmuldi, PR #1666): buildInstructorSystemPrompt's actual
// output — the scope note, and both the custom-prompt and default-prompt
// branches — was never asserted anywhere; every route test mocks it away
// (buildInstructorSystemPrompt: vi.fn().mockReturnValue("")). Mirrors
// buildAdminSystemPrompt's coverage above. Lower stakes than the tool
// pinning itself (this function's own docstring says so — it's a "keep the
// model honest" nicety, not the enforcement boundary), but cheap to add.
describe("buildInstructorSystemPrompt", () => {
  const base = { courseName: "Intro to CS", courseCode: "COSC 101" };

  it("appends the course-scope note even when a custom prompt override is set", () => {
    const prompt = buildInstructorSystemPrompt({
      ...base,
      customPrompt: "Custom instructor instructions.",
    });
    expect(prompt).toContain("Custom instructor instructions.");
    expect(prompt).toContain("You can only see COSC 101 — Intro to CS.");
  });

  it("names the course and lists the read-only tools in the default prompt", () => {
    const prompt = buildInstructorSystemPrompt(base);
    expect(prompt).toContain("COSC 101 — Intro to CS");
    expect(prompt).toContain("getCourse");
    expect(prompt).toContain("listCourseEnrollments");
    expect(prompt).toContain("listCourseTopics");
    expect(prompt).toContain("getCourseTopic");
  });

  it("disclaims platform user management, bug triage, and other courses", () => {
    const prompt = buildInstructorSystemPrompt(base);
    expect(prompt).toContain("no access to other courses, platform user management, or bug triage");
    expect(prompt).toContain(
      "You do NOT tutor students, search course materials, or manage other courses/users",
    );
  });
});

describe("parseChatMode", () => {
  it("returns 'admin' only for the literal value 'admin'", () => {
    expect(parseChatMode("admin")).toBe("admin");
  });

  it.each([undefined, null, "learning", "ADMIN", 1, {}])(
    "returns 'learning' for any other value (%p)",
    (value) => {
      expect(parseChatMode(value)).toBe("learning");
    },
  );
});

describe("chatbotTypeFromMode", () => {
  it("maps 'admin' to 'ADMIN'", () => {
    expect(chatbotTypeFromMode("admin")).toBe("ADMIN");
  });

  it("maps 'learning' to 'LEARNING'", () => {
    expect(chatbotTypeFromMode("learning")).toBe("LEARNING");
  });
});

describe("buildLearningAssistantSystemPrompt", () => {
  it("returns the custom prompt verbatim when provided, ignoring other options", () => {
    const prompt = buildLearningAssistantSystemPrompt({
      customPrompt: "My custom tutor prompt.",
      courseCode: "COSC 101",
      citeMaterials: true,
    });
    expect(prompt).toBe("My custom tutor prompt.");
  });

  it("includes the citation closing line when citeMaterials is true", () => {
    const prompt = buildLearningAssistantSystemPrompt({ citeMaterials: true });
    expect(prompt).toContain("cite the course materials");
  });

  it("uses the plain closing line when citeMaterials is false (default)", () => {
    const prompt = buildLearningAssistantSystemPrompt({});
    expect(prompt).toContain("Be helpful, conversational, and accurate.");
    expect(prompt).not.toContain("cite the course materials");
  });

  it("includes the course context line when a courseCode is given", () => {
    const prompt = buildLearningAssistantSystemPrompt({ courseCode: "COSC 101" });
    expect(prompt).toContain("Current course context: COSC 101 (UBCO)");
  });

  it("omits the course context line when no courseCode is given", () => {
    const prompt = buildLearningAssistantSystemPrompt({});
    expect(prompt).not.toContain("Current course context:");
  });
});

describe("buildLearningSystemPrompt", () => {
  it("returns the custom prompt verbatim when provided", () => {
    const prompt = buildLearningSystemPrompt({
      customPrompt: "My custom RAG tutor prompt.",
      courseCode: "COSC 101",
    });
    expect(prompt).toBe("My custom RAG tutor prompt.");
  });

  it("describes the RAG/web tools and includes the course context when given", () => {
    const prompt = buildLearningSystemPrompt({ courseCode: "COSC 101" });
    expect(prompt).toContain("getInformation");
    expect(prompt).toContain("webSearch");
    expect(prompt).toContain("fetchPage");
    expect(prompt).toContain("Current course context: COSC 101 (UBCO)");
  });

  it("omits the course context line when no courseCode is given", () => {
    const prompt = buildLearningSystemPrompt({});
    expect(prompt).not.toContain("Current course context:");
  });
});
