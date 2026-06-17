import { describe, expect, it } from "vitest";

import {
  buildAdminSystemPrompt,
  formatAdminCourseContext,
} from "~/lib/agent-tools/chat-mode";

describe("formatAdminCourseContext", () => {
  it("instructs the model to use listCourseEnrollments when UI course is selected", () => {
    const text = formatAdminCourseContext("COSC 111", "course-abc");
    expect(text).toContain("COSC 111");
    expect(text).toContain("course-abc");
    expect(text).toContain("listCourseEnrollments");
    expect(text).toContain("Do NOT ask the admin for course id or code");
  });

  it("describes platform-wide mode when no course is selected", () => {
    const text = formatAdminCourseContext(null, null);
    expect(text).toContain("No course selected");
    expect(text).toContain("platform-wide");
  });
});

describe("buildAdminSystemPrompt", () => {
  it("appends course context even when a custom prompt override is set", () => {
    const prompt = buildAdminSystemPrompt({
      courseCode: "COSC 111",
      effectiveCourseId: "course-abc",
      customPrompt: "Custom admin instructions.",
    });
    expect(prompt).toContain("Custom admin instructions.");
    expect(prompt).toContain("SELECTED COURSE (admin UI dropdown): COSC 111");
    expect(prompt).toContain("listCourseEnrollments");
  });
});
