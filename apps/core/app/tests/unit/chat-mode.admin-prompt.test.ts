import { describe, expect, it } from "vitest";

import {
  buildAdminSystemPrompt,
  formatAdminCourseContext,
  formatAdminWriteSafetyRules,
} from "~/lib/agent-tools/chat-mode";

describe("formatAdminCourseContext", () => {
  it("describes platform-wide admin chat with explicit course in tools", () => {
    const text = formatAdminCourseContext();
    expect(text).toContain("platform-wide");
    expect(text).toContain("listCourseEnrollments");
    expect(text).toContain("courseId or courseCode");
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
});
