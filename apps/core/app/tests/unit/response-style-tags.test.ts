import { describe, expect, it } from "vitest";

import {
  buildCourseResponseStylePrompt,
  courseHasAiConfig,
  resolveResponseStyleTags,
  RESPONSE_STYLE_TAGS,
} from "~/lib/ai/response-style-tags";

describe("resolveResponseStyleTags", () => {
  it("returns tags in selection order and ignores unknown ids", () => {
    expect(
      resolveResponseStyleTags(["concise", "unknown", "socratic"]),
    ).toEqual([
      RESPONSE_STYLE_TAGS.find((t) => t.id === "concise"),
      RESPONSE_STYLE_TAGS.find((t) => t.id === "socratic"),
    ]);
  });

  it("deduplicates tag ids", () => {
    const tags = resolveResponseStyleTags(["concise", "concise"]);
    expect(tags).toHaveLength(1);
    expect(tags[0]?.id).toBe("concise");
  });
});

describe("buildCourseResponseStylePrompt", () => {
  it("returns empty string when nothing is configured", () => {
    expect(buildCourseResponseStylePrompt([], "")).toBe("");
    expect(buildCourseResponseStylePrompt([], "   ")).toBe("");
  });

  it("includes tag snippets and custom instructions", () => {
    const prompt = buildCourseResponseStylePrompt(
      ["concise", "socratic"],
      "Use course notation.",
    );
    expect(prompt).toContain("## Course response style");
    expect(prompt).toContain("**Concise**");
    expect(prompt).toContain("**Socratic**");
    expect(prompt).toContain("## Additional course instructions");
    expect(prompt).toContain("Use course notation.");
  });
});

describe("courseHasAiConfig", () => {
  it("is true when tags or instructions are set", () => {
    expect(courseHasAiConfig(["concise"], "")).toBe(true);
    expect(courseHasAiConfig([], "Be brief.")).toBe(true);
    expect(courseHasAiConfig([], "")).toBe(false);
  });
});
