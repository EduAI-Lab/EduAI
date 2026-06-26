import { describe, expect, it } from "vitest";

import {
  buildAdminSystemPrompt,
  formatAdminCourseContext,
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
});
