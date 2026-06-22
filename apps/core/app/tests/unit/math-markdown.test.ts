import { describe, it, expect } from "vitest";
import { normalizeMathMarkdown } from "~/lib/ai/math-markdown";

describe("normalizeMathMarkdown", () => {
  it("converts \\( ... \\) to inline math delimiters", () => {
    expect(normalizeMathMarkdown("Solve \\(x^2 + 1\\) for x.")).toContain("$x^2 + 1$");
  });

  it("converts \\[ ... \\] to display math delimiters", () => {
    const result = normalizeMathMarkdown("Formula: \\[E = mc^2\\]");
    expect(result).toContain("$$");
    expect(result).toContain("E = mc^2");
  });

  it("wraps bare LaTeX commands in inline delimiters", () => {
    const result = normalizeMathMarkdown("The value is \\frac{1}{2} of the total.");
    expect(result).toContain("$\\frac{1}{2}$");
  });

  it("does not double-wrap existing inline math", () => {
    expect(normalizeMathMarkdown("Already $x^2$ formatted.")).toBe("Already $x^2$ formatted.");
  });

  it("returns plain text unchanged when no math is present", () => {
    expect(normalizeMathMarkdown("Hello world")).toBe("Hello world");
  });
});
